import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(import.meta.dirname, "..");
const packageName = "@cp949/iframecall";
const packageDirectory = "packages/iframecall";
// npm은 'owner/repo' 형태를 GitHub 단축표기로 읽는다. './'를 붙여 로컬 디렉토리로 넘긴다.
const publishSpec = `./${packageDirectory}`;

export function parsePublishArguments(argv) {
  const options = { action: "menu", dryRun: false };
  const actions = { "--publish": "publish" };

  for (const argument of argv) {
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    const action = actions[argument];

    if (action === undefined) {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
    if (options.action !== "menu") {
      throw new Error(
        `동작 인자는 하나만 지정합니다: ${options.action}, ${action}`,
      );
    }

    options.action = action;
  }

  if (options.dryRun && options.action === "menu") {
    options.action = "publish";
  }

  return options;
}

// 루트 manifest에는 version이 없다. 있으면 패키지 version과 같아야 한다.
export function assertReleaseVersion({ root, package: packageVersion }) {
  if (typeof packageVersion !== "string" || packageVersion.length === 0) {
    throw new Error("release version이 비어 있습니다.");
  }
  if (root !== undefined && root !== packageVersion) {
    throw new Error(
      `release version이 다릅니다: root=${root}, package=${packageVersion}`,
    );
  }

  return packageVersion;
}

export function formatTagMessage(version) {
  return `v${version}\n\n${packageName}@${version}`;
}

// 태그는 배포한 커밋의 기록이므로 작업 트리가 커밋 상태와 다르거나
// 같은 이름의 태그가 다른 커밋을 가리키면 만들지 않는다.
export function planTagPush({
  version,
  workingTreeDirty,
  tagCommit,
  headCommit,
}) {
  const tagName = `v${version}`;

  if (workingTreeDirty) {
    return {
      action: "abort",
      reason:
        "작업 트리가 깨끗하지 않습니다. 배포한 커밋 상태로 정리한 뒤 다시 시도하세요.",
    };
  }
  if (tagCommit === null) return { action: "create-and-push", tagName };
  if (tagCommit === headCommit) return { action: "push-only", tagName };

  return {
    action: "abort",
    reason: `${tagName} 태그가 이미 다른 커밋(${tagCommit})을 가리킵니다. 태그를 직접 확인하세요.`,
  };
}

// 배포된 manifest가 로컬 manifest와 같은 peer 계약을 갖는지 확인한다.
export function assertPublishedPeerDependencies(published, expected) {
  const publishedEntries = Object.entries(published ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const expectedEntries = Object.entries(expected ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const format = (entries) =>
    entries.length === 0
      ? "(없음)"
      : entries.map(([name, range]) => `${name}@${range}`).join(", ");

  if (format(publishedEntries) !== format(expectedEntries)) {
    throw new Error(
      `배포된 peerDependencies가 로컬과 다릅니다: ${format(publishedEntries)} != ${format(expectedEntries)}`,
    );
  }

  return format(expectedEntries);
}

// exports 트리의 문자열 leaf만 모은다. 부분 빌드로 빠진 진입점을 찾는 데 쓴다.
export function collectExportPaths(exportsField) {
  const paths = [];
  const visit = (node) => {
    if (typeof node === "string") {
      paths.push(node);
      return;
    }
    if (node && typeof node === "object") {
      for (const value of Object.values(node)) visit(value);
    }
  };

  visit(exportsField);

  return [...new Set(paths)];
}

// 한글은 터미널에서 두 칸을 차지하므로 code unit 길이 대신 표시 폭으로 맞춘다.
export function displayWidth(value) {
  let width = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0);
    const wide =
      (codePoint >= 0x1100 && codePoint <= 0x115f) ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60);

    width += wide ? 2 : 1;
  }

  return width;
}

function padDisplay(value, width) {
  return value + " ".repeat(Math.max(0, width - displayWidth(value)));
}

export function formatStatusRow(label, localVersion, registryLookup) {
  let registry;
  let mark;

  if (registryLookup.status === "published") {
    registry = registryLookup.version;
    mark = registryLookup.version === localVersion ? "배포됨" : "불일치";
  } else if (registryLookup.status === "missing") {
    registry = "미배포";
    mark = "대상";
  } else {
    registry = "조회 실패";
    mark = `확인 필요 (${registryLookup.reason})`;
  }

  return `  ${padDisplay(label, 12)} 로컬 ${padDisplay(localVersion, 8)} registry ${padDisplay(registry, 8)} ${mark}`;
}

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDirectory,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });

  if (result.error) throw result.error;

  return result;
}

async function readManifest(path) {
  return JSON.parse(await readFile(join(rootDirectory, path), "utf8"));
}

export function classifyRegistryVersionResult(result) {
  if (result.status === 0) {
    const version = result.stdout.trim();

    if (version !== "") return { status: "published", version };
    return { status: "error", reason: "empty response" };
  }

  const errorCode = result.stderr
    .match(/(?:^|\s)code\s+([A-Z0-9_]+)/i)?.[1]
    ?.toUpperCase();

  if (errorCode === "E404") return { status: "missing" };

  return {
    status: "error",
    reason: errorCode ?? `exit ${result.status ?? "unknown"}`,
  };
}

export function planPublish({ dryRun, registryLookup }) {
  if (dryRun || registryLookup.status === "missing")
    return { action: "proceed" };

  if (registryLookup.status === "published") {
    return {
      action: "abort",
      reason: `${packageName}@${registryLookup.version}은 이미 배포되어 있습니다.`,
    };
  }

  return {
    action: "abort",
    reason: `registry 조회에 실패해 실제 배포를 중단합니다: ${registryLookup.reason}`,
  };
}

function readRegistryVersion(name, version) {
  const result = run("npm", ["view", `${name}@${version}`, "version"], {
    capture: true,
  });

  return classifyRegistryVersionResult(result);
}

function readEffectiveRegistry() {
  const result = run("npm", ["config", "get", "registry"], { capture: true });

  return result.status === 0 ? result.stdout.trim() : "(조회 실패)";
}

export function publishPackage(
  version,
  dryRun,
  registryLookup,
  runCommand = run,
) {
  const args = ["publish", publishSpec, "--access", "public"];
  const plan = planPublish({ dryRun, registryLookup });

  if (plan.action === "abort") {
    console.log(plan.reason);
    return false;
  }

  console.log("\n$ pnpm verify:release");
  const verified = runCommand("pnpm", ["verify:release"]);

  if (verified.status !== 0) {
    console.log("\nrelease 전체 검증에 실패해 배포를 중단합니다.");
    return false;
  }

  if (dryRun) args.push("--dry-run");

  console.log(`\n$ npm ${args.join(" ")}`);
  const result = runCommand("npm", args);

  if (result.status !== 0) {
    console.log(`\n${packageName} 배포에 실패했습니다.`);
    console.log(`같은 version으로 재시도하세요: npm ${args.join(" ")}`);
    console.log(
      "이미 배포된 version은 제거하거나 바꾸지 마세요. 다음 patch version으로 올리세요.",
    );
    return false;
  }

  if (dryRun) {
    console.log(
      `\n${packageName}@${version} dry-run이 성공했습니다. 실제 배포는 되지 않았습니다.`,
    );
    return true;
  }

  console.log(`\n${packageName}@${version} 배포 명령이 성공했습니다.`);
  console.log(
    "registry 반영에 수 분이 걸릴 수 있습니다. 메뉴 4번으로 다시 조회하세요.",
  );
  return true;
}

function pushVersionTag(version) {
  const status = run("git", ["status", "--porcelain"], { capture: true });
  const head = run("git", ["rev-parse", "HEAD"], { capture: true });
  const tag = run(
    "git",
    ["rev-parse", "--verify", "--quiet", `refs/tags/v${version}^{commit}`],
    {
      capture: true,
    },
  );
  const plan = planTagPush({
    version,
    workingTreeDirty: status.status !== 0 || status.stdout.trim() !== "",
    tagCommit: tag.status === 0 ? tag.stdout.trim() : null,
    headCommit: head.stdout.trim(),
  });

  if (plan.action === "abort") {
    console.log(plan.reason);
    return false;
  }

  if (plan.action === "create-and-push") {
    const created = run("git", [
      "tag",
      "-a",
      plan.tagName,
      "-m",
      formatTagMessage(version),
    ]);

    if (created.status !== 0) {
      console.log(`${plan.tagName} 태그 생성에 실패했습니다.`);
      return false;
    }
    console.log(`${plan.tagName} 태그를 HEAD에 만들었습니다.`);
  } else {
    console.log(
      `${plan.tagName} 태그가 이미 HEAD를 가리킵니다. push만 진행합니다.`,
    );
  }

  const pushed = run("git", ["push", "origin", plan.tagName]);

  if (pushed.status !== 0) {
    console.log(
      `태그 push에 실패했습니다. 재시도하세요: git push origin ${plan.tagName}`,
    );
    return false;
  }

  console.log(`origin에 ${plan.tagName} 태그를 push했습니다.`);
  return true;
}

function reportPublished(version, manifest) {
  const viewed = run("npm", ["view", `${packageName}@${version}`, "version"], {
    capture: true,
  });

  if (viewed.status !== 0) {
    console.log(`${packageName}@${version}: registry에서 조회되지 않습니다.`);
    return;
  }

  console.log(`${packageName}@${version}: 배포됨`);

  const peers = run(
    "npm",
    ["view", `${packageName}@${version}`, "peerDependencies", "--json"],
    {
      capture: true,
    },
  );

  if (peers.status !== 0) {
    console.log("peerDependencies는 아직 조회되지 않습니다.");
    return;
  }

  try {
    const output = peers.stdout.trim();
    const summary = assertPublishedPeerDependencies(
      output === "" ? {} : JSON.parse(output),
      manifest.peerDependencies,
    );

    console.log(`peerDependencies가 로컬과 같습니다: ${summary}`);
  } catch (error) {
    console.log(error.message);
  }
}

export function createMenuItems({ version, state, operations }) {
  return [
    {
      key: "1",
      label: "전체 검증",
      detail: "pnpm verify:release",
      execute: operations.verify,
    },
    {
      key: "2",
      label: "dry-run 배포",
      detail: `npm publish ${publishSpec} --access public --dry-run`,
      execute: () => operations.publish(true, state.registryLookup),
    },
    {
      key: "3",
      label: "배포",
      detail: `npm publish ${publishSpec} --access public`,
      execute: () => operations.publish(false, state.registryLookup),
    },
    {
      key: "4",
      label: "registry 상태 새로고침",
      detail: "",
      execute: () => {
        state.registryLookup = operations.refreshRegistry();
      },
    },
    {
      key: "5",
      label: "배포 결과 확인",
      detail: "version과 peerDependencies",
      execute: operations.reportPublished,
    },
    {
      key: "6",
      label: "버전 태그 붙여서 푸시",
      detail: `annotated tag v${version} 생성 후 origin에 push`,
      execute: operations.pushVersionTag,
    },
    {
      key: "b",
      label: "빌드만 실행",
      detail: "pnpm build:release",
      execute: operations.build,
    },
    {
      key: "q",
      label: "종료",
      detail: "",
      execute: () => "exit",
    },
  ];
}

export function formatMenuItems(items) {
  return items
    .map(({ key, label, detail }) =>
      detail === ""
        ? `  ${key}) ${label}`
        : `  ${key}) ${padDisplay(label, 28)}${detail}`,
    )
    .join("\n");
}

export function executeMenuChoice(items, choice) {
  const normalizedChoice = choice.trim().toLowerCase() || "q";
  const item = items.find(({ key }) => key === normalizedChoice);

  if (item === undefined) {
    return { status: "unknown", choice: normalizedChoice };
  }

  return item.execute() === "exit" ? { status: "exit" } : { status: "handled" };
}

function printStatus(version, registryLookup, registry, warnings, items) {
  console.log(`\n=== ${packageName} 배포 도구 · release ${version} ===`);
  console.log(`  registry ${registry}`);
  console.log(formatStatusRow("iframecall", version, registryLookup));

  for (const warning of warnings) console.log(`  경고: ${warning}`);

  console.log("");
  console.log(formatMenuItems(items));
  console.log("");
}

// 이 저장소는 패키지 디렉토리를 그대로 배포하므로 dist 상태가 곧 배포 산출물이다.
function collectWarnings(manifest) {
  const warnings = [];
  const status = run("git", ["status", "--porcelain"], { capture: true });

  if (status.status === 0 && status.stdout.trim() !== "") {
    warnings.push(
      "작업 트리가 깨끗하지 않습니다. 배포 산출물이 커밋 상태와 다를 수 있습니다.",
    );
  }

  if (!existsSync(join(rootDirectory, packageDirectory, "dist"))) {
    warnings.push(
      `${packageDirectory}/dist 가 없습니다. pnpm build:release 를 먼저 실행하세요.`,
    );
    return warnings;
  }

  const declared = [
    manifest.main,
    manifest.types,
    ...collectExportPaths(manifest.exports),
  ].filter((path) => typeof path === "string");
  const missing = [...new Set(declared)].filter(
    (path) => !existsSync(join(rootDirectory, packageDirectory, path)),
  );

  if (missing.length > 0) {
    const sample = missing.slice(0, 3).join(", ");
    const rest = missing.length > 3 ? ` 외 ${missing.length - 3}건` : "";

    warnings.push(`package.json이 가리키는 파일이 없습니다: ${sample}${rest}`);
  }

  return warnings;
}

async function runMenu(version, manifest) {
  const state = {
    registryLookup: readRegistryVersion(packageName, version),
  };
  const registry = readEffectiveRegistry();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const items = createMenuItems({
    version,
    state,
    operations: {
      publish: (dryRun, registryLookup) =>
        publishPackage(version, dryRun, registryLookup),
      verify: () => run("pnpm", ["verify:release"]),
      build: () => run("pnpm", ["build:release"]),
      refreshRegistry: () => readRegistryVersion(packageName, version),
      reportPublished: () => reportPublished(version, manifest),
      pushVersionTag: () => pushVersionTag(version),
    },
  });

  try {
    for (;;) {
      printStatus(
        version,
        state.registryLookup,
        registry,
        collectWarnings(manifest),
        items,
      );
      const choice = await rl.question("선택: ");
      const result = executeMenuChoice(items, choice);

      if (result.status === "exit") return;
      if (result.status === "unknown")
        console.log(`알 수 없는 선택입니다: ${result.choice}`);
    }
  } finally {
    rl.close();
  }
}

async function main() {
  const options = parsePublishArguments(process.argv.slice(2));
  const [rootManifest, packageManifest] = await Promise.all([
    readManifest("package.json"),
    readManifest(`${packageDirectory}/package.json`),
  ]);
  const version = assertReleaseVersion({
    root: rootManifest.version,
    package: packageManifest.version,
  });

  if (options.action === "publish") {
    const registryLookup = readRegistryVersion(packageName, version);

    if (!publishPackage(version, options.dryRun, registryLookup))
      process.exitCode = 1;
    return;
  }

  if (!process.stdin.isTTY) {
    throw new Error("대화형 메뉴를 쓸 수 없습니다. --publish 를 지정하세요.");
  }

  await runMenu(version, packageManifest);
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

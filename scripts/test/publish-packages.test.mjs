import assert from "node:assert/strict";
import test from "node:test";

import * as publishTool from "../publish-packages.mjs";

import {
  assertPublishedPeerDependencies,
  assertReleaseVersion,
  classifyRegistryVersionResult,
  collectExportPaths,
  displayWidth,
  formatStatusRow,
  formatTagMessage,
  parsePublishArguments,
  planPublish,
  planTagPush,
} from "../publish-packages.mjs";

function createMenuFixture() {
  const calls = [];
  const state = { registryLookup: { status: "missing" } };
  const operations = {
    publish(dryRun, registryLookup) {
      calls.push(["publish", dryRun, registryLookup]);
    },
    verify() {
      calls.push(["verify"]);
    },
    build() {
      calls.push(["build"]);
    },
    refreshRegistry() {
      calls.push(["refreshRegistry"]);
      return { status: "published", version: "0.3.0" };
    },
    reportPublished() {
      calls.push(["reportPublished"]);
    },
    pushVersionTag() {
      calls.push(["pushVersionTag"]);
    },
  };

  return { calls, operations, state };
}

test("숫자 메뉴는 배포 절차 순서대로 같은 항목의 동작을 실행한다", () => {
  assert.equal(typeof publishTool.createMenuItems, "function");
  assert.equal(typeof publishTool.formatMenuItems, "function");
  assert.equal(typeof publishTool.executeMenuChoice, "function");

  const fixture = createMenuFixture();
  const items = publishTool.createMenuItems({
    version: "0.3.0",
    state: fixture.state,
    operations: fixture.operations,
  });

  assert.deepEqual(
    items.map(({ key, label }) => [key, label]),
    [
      ["1", "전체 검증"],
      ["2", "dry-run 배포"],
      ["3", "배포"],
      ["4", "registry 상태 새로고침"],
      ["5", "배포 결과 확인"],
      ["6", "버전 태그 붙여서 푸시"],
      ["b", "빌드만 실행"],
      ["q", "종료"],
    ],
  );

  for (const choice of ["1", "2", "3", "4", "5", "6", "b"]) {
    assert.deepEqual(publishTool.executeMenuChoice(items, choice), {
      status: "handled",
    });
  }
  assert.deepEqual(fixture.calls, [
    ["verify"],
    ["publish", true, { status: "missing" }],
    ["publish", false, { status: "missing" }],
    ["refreshRegistry"],
    ["reportPublished"],
    ["pushVersionTag"],
    ["build"],
  ]);
});

test("registry 새로고침 메뉴는 다음 실행에 사용할 상태를 갱신한다", () => {
  assert.equal(typeof publishTool.createMenuItems, "function");
  assert.equal(typeof publishTool.executeMenuChoice, "function");

  const fixture = createMenuFixture();
  const items = publishTool.createMenuItems({
    version: "0.3.0",
    state: fixture.state,
    operations: fixture.operations,
  });

  assert.deepEqual(publishTool.executeMenuChoice(items, "4"), {
    status: "handled",
  });
  assert.deepEqual(fixture.state.registryLookup, {
    status: "published",
    version: "0.3.0",
  });
});

test("종료 입력과 알 수 없는 메뉴 입력을 구분한다", () => {
  assert.equal(typeof publishTool.createMenuItems, "function");
  assert.equal(typeof publishTool.executeMenuChoice, "function");

  const fixture = createMenuFixture();
  const items = publishTool.createMenuItems({
    version: "0.3.0",
    state: fixture.state,
    operations: fixture.operations,
  });

  assert.deepEqual(publishTool.executeMenuChoice(items, "Q"), {
    status: "exit",
  });
  assert.deepEqual(publishTool.executeMenuChoice(items, ""), {
    status: "exit",
  });
  assert.deepEqual(publishTool.executeMenuChoice(items, "9"), {
    status: "unknown",
    choice: "9",
  });
});

test("registry 조회 결과에서 배포됨, 미배포, 조회 실패를 구분한다", () => {
  assert.deepEqual(
    classifyRegistryVersionResult({ status: 0, stdout: "0.3.0\n", stderr: "" }),
    { status: "published", version: "0.3.0" },
  );
  assert.deepEqual(
    classifyRegistryVersionResult({
      status: 1,
      stdout: "",
      stderr: "npm error code E404\nnpm error 404 Not Found",
    }),
    { status: "missing" },
  );
  assert.deepEqual(
    classifyRegistryVersionResult({
      status: 1,
      stdout: "",
      stderr: "npm error code EAI_AGAIN\nnpm error request failed",
    }),
    { status: "error", reason: "EAI_AGAIN" },
  );
});

test("실제 배포는 registry에서 미배포가 확인된 경우에만 허용한다", () => {
  assert.deepEqual(
    planPublish({ dryRun: false, registryLookup: { status: "missing" } }),
    {
      action: "proceed",
    },
  );
  assert.match(
    planPublish({
      dryRun: false,
      registryLookup: { status: "published", version: "0.3.0" },
    }).reason,
    /이미 배포되어 있습니다/,
  );
  assert.match(
    planPublish({
      dryRun: false,
      registryLookup: { status: "error", reason: "EAI_AGAIN" },
    }).reason,
    /조회에 실패해 실제 배포를 중단합니다/,
  );
});

test("dry-run은 registry 조회 실패 상태에서도 허용한다", () => {
  assert.deepEqual(
    planPublish({
      dryRun: true,
      registryLookup: { status: "error", reason: "EAI_AGAIN" },
    }),
    { action: "proceed" },
  );
});

test("배포 전에 release 전체 검증을 실행한다", () => {
  assert.equal(typeof publishTool.publishPackage, "function");

  const commands = [];
  const succeeded = publishTool.publishPackage(
    "0.3.0",
    false,
    { status: "missing" },
    (command, args) => {
      commands.push([command, args]);
      return { status: 0 };
    },
  );

  assert.equal(succeeded, true);
  assert.deepEqual(commands, [
    ["pnpm", ["verify:release"]],
    ["npm", ["publish", "./packages/iframecall", "--access", "public"]],
  ]);
});

test("release 전체 검증이 실패하면 배포하지 않는다", () => {
  assert.equal(typeof publishTool.publishPackage, "function");

  const commands = [];
  const succeeded = publishTool.publishPackage(
    "0.3.0",
    true,
    { status: "missing" },
    (command, args) => {
      commands.push([command, args]);
      return { status: 1 };
    },
  );

  assert.equal(succeeded, false);
  assert.deepEqual(commands, [["pnpm", ["verify:release"]]]);
});

test("인자가 없으면 대화형 메뉴를 선택한다", () => {
  assert.deepEqual(parsePublishArguments([]), {
    action: "menu",
    dryRun: false,
  });
});

test("배포 인자와 dry-run을 읽는다", () => {
  assert.deepEqual(parsePublishArguments(["--publish"]), {
    action: "publish",
    dryRun: false,
  });
  assert.deepEqual(parsePublishArguments(["--publish", "--dry-run"]), {
    action: "publish",
    dryRun: true,
  });
  assert.deepEqual(parsePublishArguments(["--dry-run"]), {
    action: "publish",
    dryRun: true,
  });
});

test("알 수 없는 인자를 거부한다", () => {
  assert.throws(
    () => parsePublishArguments(["--force"]),
    /알 수 없는 인자입니다: --force/,
  );
});

test("동작 인자를 두 개 지정하면 거부한다", () => {
  assert.throws(
    () => parsePublishArguments(["--publish", "--publish"]),
    /동작 인자는 하나만 지정합니다: publish, publish/,
  );
});

// 루트 manifest에는 version이 없다. 패키지 version만으로 release를 정한다.
test("루트 version이 없으면 패키지 version을 쓴다", () => {
  assert.equal(
    assertReleaseVersion({ root: undefined, package: "0.3.0" }),
    "0.3.0",
  );
});

test("루트 version이 패키지 version과 다르면 거부한다", () => {
  assert.throws(
    () => assertReleaseVersion({ root: "0.2.0", package: "0.3.0" }),
    /release version이 다릅니다: root=0.2.0, package=0.3.0/,
  );
});

test("빈 release version을 거부한다", () => {
  assert.throws(
    () => assertReleaseVersion({ package: "" }),
    /release version이 비어 있습니다/,
  );
  assert.throws(
    () => assertReleaseVersion({ package: undefined }),
    /release version이 비어 있습니다/,
  );
});

test("태그가 없으면 만들고 push한다", () => {
  assert.deepEqual(
    planTagPush({
      version: "0.3.0",
      workingTreeDirty: false,
      tagCommit: null,
      headCommit: "a1",
    }),
    { action: "create-and-push", tagName: "v0.3.0" },
  );
});

test("태그가 이미 HEAD를 가리키면 push만 한다", () => {
  assert.deepEqual(
    planTagPush({
      version: "0.3.0",
      workingTreeDirty: false,
      tagCommit: "a1",
      headCommit: "a1",
    }),
    { action: "push-only", tagName: "v0.3.0" },
  );
});

test("작업 트리가 더러우면 태그를 만들지 않는다", () => {
  const plan = planTagPush({
    version: "0.3.0",
    workingTreeDirty: true,
    tagCommit: null,
    headCommit: "a1",
  });

  assert.equal(plan.action, "abort");
  assert.match(plan.reason, /작업 트리가 깨끗하지 않습니다/);
});

test("태그가 다른 커밋을 가리키면 태그를 건드리지 않는다", () => {
  const plan = planTagPush({
    version: "0.3.0",
    workingTreeDirty: false,
    tagCommit: "b2",
    headCommit: "a1",
  });

  assert.equal(plan.action, "abort");
  assert.match(
    plan.reason,
    /v0\.3\.0 태그가 이미 다른 커밋\(b2\)을 가리킵니다/,
  );
});

test("배포된 peerDependencies가 로컬과 같으면 요약을 돌려준다", () => {
  assert.equal(
    assertPublishedPeerDependencies({ react: "^19" }, { react: "^19" }),
    "react@^19",
  );
});

test("peerDependencies가 없는 경우도 같은 것으로 본다", () => {
  assert.equal(assertPublishedPeerDependencies(undefined, undefined), "(없음)");
  assert.equal(assertPublishedPeerDependencies({}, undefined), "(없음)");
});

test("peerDependencies range가 다르면 거부한다", () => {
  assert.throws(
    () => assertPublishedPeerDependencies({ react: "^18" }, { react: "^19" }),
    /배포된 peerDependencies가 로컬과 다릅니다: react@\^18 != react@\^19/,
  );
});

// 선언 순서가 달라도 같은 계약이면 통과해야 한다.
test("peerDependencies 선언 순서는 결과에 영향을 주지 않는다", () => {
  assert.equal(
    assertPublishedPeerDependencies(
      { react: "^18 || ^19", "@types/react": "^18 || ^19" },
      { "@types/react": "^18 || ^19", react: "^18 || ^19" },
    ),
    "@types/react@^18 || ^19, react@^18 || ^19",
  );
});

test("exports의 문자열 leaf만 중복 없이 모은다", () => {
  assert.deepEqual(
    collectExportPaths({
      "./host": { types: "./dist/host.d.ts", import: "./dist/host.js" },
      "./iframe": { types: "./dist/iframe.d.ts", import: "./dist/iframe.js" },
      "./alias": "./dist/host.js",
    }),
    [
      "./dist/host.d.ts",
      "./dist/host.js",
      "./dist/iframe.d.ts",
      "./dist/iframe.js",
    ],
  );
});

test("exports가 없으면 빈 목록을 돌려준다", () => {
  assert.deepEqual(collectExportPaths(undefined), []);
});

test("한글은 표시 폭을 두 칸으로 센다", () => {
  assert.equal(displayWidth("배포"), 4);
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("배포 도구"), 9);
});

test("태그 메시지에 패키지와 version을 적는다", () => {
  assert.equal(formatTagMessage("0.3.0"), "v0.3.0\n\n@cp949/iframecall@0.3.0");
});

test("registry version이 없으면 미배포 대상으로 표시한다", () => {
  const row = formatStatusRow("iframecall", "0.3.0", { status: "missing" });

  assert.match(row, /미배포/);
  assert.match(row, /대상$/);
});

test("registry version이 로컬과 다르면 배포 대상으로 표시한다", () => {
  assert.match(
    formatStatusRow("iframecall", "0.3.0", {
      status: "published",
      version: "0.2.0",
    }),
    /불일치$/,
  );
});

test("registry version이 로컬과 같으면 배포됨으로 표시한다", () => {
  assert.match(
    formatStatusRow("iframecall", "0.3.0", {
      status: "published",
      version: "0.3.0",
    }),
    /배포됨$/,
  );
});

test("registry 조회 실패를 미배포와 구분해 표시한다", () => {
  const row = formatStatusRow("iframecall", "0.3.0", {
    status: "error",
    reason: "EAI_AGAIN",
  });

  assert.match(row, /조회 실패/);
  assert.match(row, /확인 필요 \(EAI_AGAIN\)$/);
});

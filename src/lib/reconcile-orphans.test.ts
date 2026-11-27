import { describe, expect, it } from "vitest";

import { orphanHardDeletePlan } from "./reconcile-orphans";

describe("orphanHardDeletePlan", () => {
  it("is a no-op when nothing was unlinked", () => {
    expect(orphanHardDeletePlan([])).toBeNull();
  });

  it("detaches children of every orphan before those orphans are deleted", () => {
    const plan = orphanHardDeletePlan(["parent-a", "parent-b"]);
    expect(plan).not.toBeNull();
    expect(plan!.detachChildrenOf).toEqual(["parent-a", "parent-b"]);
    expect(plan!.deleteIds).toEqual(["parent-a", "parent-b"]);
  });

  it("never deletes an orphan without also detaching its children", () => {
    const plan = orphanHardDeletePlan(["only-parent"]);
    expect(plan!.detachChildrenOf).toEqual(plan!.deleteIds);
  });
});

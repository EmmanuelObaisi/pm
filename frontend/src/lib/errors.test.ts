import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

describe("errorMessage", () => {
  it("uses the detail an ApiError carries", () => {
    expect(errorMessage(new ApiError(404, "Board not found"), "Nope")).toBe(
      "Board not found"
    );
  });

  it("falls back for anything that is not an error", () => {
    expect(errorMessage("boom", "Could not load boards")).toBe("Could not load boards");
  });
});

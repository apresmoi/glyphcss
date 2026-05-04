import { describe, it, expect } from "vitest";
import { parseMtl } from "./parseMtl";

describe("parseMtl", () => {
  describe("basic structure", () => {
    it("returns empty colors and textures for empty input", () => {
      const result = parseMtl("");
      expect(result.colors).toEqual({});
      expect(result.textures).toEqual({});
    });

    it("returns MtlParseResult with colors and textures keys", () => {
      const result = parseMtl("newmtl Red\nKd 1 0 0\n");
      expect(result).toHaveProperty("colors");
      expect(result).toHaveProperty("textures");
    });
  });

  describe("newmtl + Kd", () => {
    it("parses a single red material", () => {
      const mtl = `newmtl Red\nKd 1 0 0\n`;
      const { colors } = parseMtl(mtl);
      expect(colors["Red"]).toBe("#ff0000");
    });

    it("parses a single green material", () => {
      const mtl = `newmtl Green\nKd 0 1 0\n`;
      const { colors } = parseMtl(mtl);
      expect(colors["Green"]).toBe("#00ff00");
    });

    it("parses a single blue material", () => {
      const mtl = `newmtl Blue\nKd 0 0 1\n`;
      const { colors } = parseMtl(mtl);
      expect(colors["Blue"]).toBe("#0000ff");
    });

    it("parses multiple materials", () => {
      const mtl = `newmtl A\nKd 1 0 0\nnewmtl B\nKd 0 1 0\n`;
      const { colors } = parseMtl(mtl);
      expect(colors["A"]).toBe("#ff0000");
      expect(colors["B"]).toBe("#00ff00");
    });

    it("rounds Kd values correctly (0.5 → 128 = 0x80)", () => {
      const mtl = `newmtl Gray\nKd 0.5 0.5 0.5\n`;
      const { colors } = parseMtl(mtl);
      // Math.round(0.5 * 255) = 128 = 0x80
      expect(colors["Gray"]).toBe("#808080");
    });

    it("clamps Kd values >1 to 255", () => {
      const mtl = `newmtl Over\nKd 2 0 0\n`;
      const { colors } = parseMtl(mtl);
      expect(colors["Over"]).toBe("#ff0000");
    });

    it("clamps negative Kd values to 0", () => {
      const mtl = `newmtl Neg\nKd -1 0 0\n`;
      const { colors } = parseMtl(mtl);
      expect(colors["Neg"]).toBe("#000000");
    });

    it("Kd before any newmtl is ignored (currentName is null)", () => {
      const mtl = `Kd 1 0 0\nnewmtl Later\nKd 0 1 0\n`;
      const { colors } = parseMtl(mtl);
      expect(Object.keys(colors)).toEqual(["Later"]);
      expect(colors["Later"]).toBe("#00ff00");
    });

    it("ignores Kd with non-numeric values", () => {
      const mtl = `newmtl Bad\nKd foo bar baz\n`;
      const { colors } = parseMtl(mtl);
      expect(colors["Bad"]).toBeUndefined();
    });

    it("ignores partially numeric Kd (first value NaN)", () => {
      const mtl = `newmtl Bad2\nKd foo 0 0\n`;
      const { colors } = parseMtl(mtl);
      expect(colors["Bad2"]).toBeUndefined();
    });
  });

  describe("map_Kd", () => {
    it("parses a simple texture path", () => {
      const mtl = `newmtl Wood\nmap_Kd wood.png\n`;
      const { textures } = parseMtl(mtl);
      expect(textures["Wood"]).toBe("wood.png");
    });

    it("map_Kd with options before path — takes the last token", () => {
      const mtl = `newmtl Wood\nmap_Kd -s 1 1 1 wood.png\n`;
      const { textures } = parseMtl(mtl);
      expect(textures["Wood"]).toBe("wood.png");
    });

    it("normalizes Windows backslashes to forward slashes", () => {
      const mtl = `newmtl WinPath\nmap_Kd textures\\wood.png\n`;
      const { textures } = parseMtl(mtl);
      expect(textures["WinPath"]).toBe("textures/wood.png");
    });

    it("normalizes multiple backslashes", () => {
      const mtl = `newmtl WinDeep\nmap_Kd textures\\\\sub\\\\wood.png\n`;
      const { textures } = parseMtl(mtl);
      expect(textures["WinDeep"]).toBe("textures/sub/wood.png");
    });

    it("map_Kd before any newmtl is ignored", () => {
      const mtl = `map_Kd orphan.png\nnewmtl Mat\nKd 1 0 0\n`;
      const { textures } = parseMtl(mtl);
      expect(textures).toEqual({});
    });

    it("material can have both Kd color and map_Kd texture", () => {
      const mtl = `newmtl Combo\nKd 1 0 0\nmap_Kd combo.png\n`;
      const { colors, textures } = parseMtl(mtl);
      expect(colors["Combo"]).toBe("#ff0000");
      expect(textures["Combo"]).toBe("combo.png");
    });
  });

  describe("comment and blank line skipping", () => {
    it("ignores # comment lines", () => {
      const mtl = `# This is a comment\nnewmtl Mat\n# another comment\nKd 1 0 0\n`;
      const { colors } = parseMtl(mtl);
      expect(colors["Mat"]).toBe("#ff0000");
    });

    it("ignores blank lines", () => {
      const mtl = `\nnewmtl Mat\n\nKd 0 0 1\n\n`;
      const { colors } = parseMtl(mtl);
      expect(colors["Mat"]).toBe("#0000ff");
    });

    it("ignores lines with only whitespace", () => {
      const mtl = `newmtl Mat\n   \nKd 1 0 0\n`;
      const { colors } = parseMtl(mtl);
      expect(colors["Mat"]).toBe("#ff0000");
    });
  });

  describe("edge cases", () => {
    it("material name with spaces is trimmed", () => {
      const mtl = `newmtl  MyMat  \nKd 1 0 0\n`;
      const { colors } = parseMtl(mtl);
      // newmtl line: line.slice(7).trim() → "MyMat"
      expect(colors["MyMat"]).toBe("#ff0000");
    });

    it("other directives (Ns, Ka, Ks) are ignored gracefully", () => {
      const mtl = `newmtl Fancy\nNs 100\nKa 0 0 0\nKd 1 0.5 0\nKs 1 1 1\nd 1\n`;
      const { colors, textures } = parseMtl(mtl);
      expect(colors["Fancy"]).toMatch(/^#/);
      expect(Object.keys(textures)).toHaveLength(0);
    });

    it("white material: Kd 1 1 1 → #ffffff", () => {
      const { colors } = parseMtl(`newmtl White\nKd 1 1 1\n`);
      expect(colors["White"]).toBe("#ffffff");
    });

    it("black material: Kd 0 0 0 → #000000", () => {
      const { colors } = parseMtl(`newmtl Black\nKd 0 0 0\n`);
      expect(colors["Black"]).toBe("#000000");
    });
  });
});

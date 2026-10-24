import { expect, it } from "vitest";
import { SITE_LINKS, isSiteLinkActive } from "./navigation";

const active = (pathname: string) => SITE_LINKS.filter((link) => isSiteLinkActive(pathname, link.href)).map((link) => link.label);

it("marks a workbench only on its own page and its docs pages as Usage", () => {
  expect(active("/maps")).toEqual(["Maps"]);
  expect(active("/maps/")).toEqual(["Maps"]);
  expect(active("/charts")).toEqual(["Charts"]);
  expect(active("/diagrams/")).toEqual(["Diagrams"]);
  for (const docs of ["/maps/overview/", "/charts/bar/", "/diagrams/options/", "/guides/effects/", "/quickstart/"]) {
    expect(active(docs)).toEqual(["Usage"]);
  }
  expect(active("/examples/city")).toEqual(["Examples"]);
  expect(active("/")).toEqual(["Home"]);
});

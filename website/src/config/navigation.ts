export const SITE_LINKS = [
  { href: "/", label: "Home", mobileHidden: true },
  { href: "/quickstart", label: "Usage" },
  { href: "/gallery", label: "Gallery" },
  { href: "/synth", label: "Synth" },
  { href: "/maps", label: "Maps" },
  { href: "/charts", label: "Charts" },
  { href: "/diagrams", label: "Diagrams" },
  { href: "/examples/world", label: "Examples" },
  { href: "/wordart", label: "WordArt" },
] as const;
export function isSiteLinkActive(pathname: string, href: string): boolean {
  const path = pathname.replace(/\/$/, "") || "/";
  if (href === "/") return path === "/";
  if (href === "/examples/world") return path.startsWith("/examples");
  if (href === "/quickstart")
    return (
      !SITE_LINKS.some(
        (link) => link.href !== "/" && link.href !== "/quickstart" && isSiteLinkActive(path, link.href),
      ) &&
      path !== "/" &&
      path !== "/bench"
    );
  return path === href || path.startsWith(href + "/");
}

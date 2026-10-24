export function softwareApplication(product: "diagrams" | "charts", description: string) {
  const url = `https://glyphcss.com/${product}/`;
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: `glyphcss ${product}`,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web, Node.js",
    description,
    url,
    image: `https://glyphcss.com/og/${product}.png`,
    codeRepository: "https://github.com/apresmoi/glyphcss",
    sameAs: ["https://github.com/apresmoi/glyphcss", `https://www.npmjs.com/package/@glyphcss/${product}`],
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}

export function ogGeneratorRoutes() {
  return {
    name: "og-generator-routes",
    hooks: {
      "astro:config:setup": ({ command, injectRoute }) => {
        // These large data responses are inputs to the local card generator.
        if (command !== "dev") return;
        for (const name of ["og-manifest", "og-renders"]) {
          injectRoute({
            pattern: `/${name}.json`,
            entrypoint: new URL(
              `../integrations/astro/${name}.json.ts`,
              import.meta.url,
            ),
          });
        }
      },
    },
  };
}

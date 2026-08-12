import { defineConfig } from "playwright/test";

const referenceChromium = process.env.GLYPHCSS_REFERENCE_CHROMIUM;
const referenceHeadful = process.env.GLYPHCSS_REFERENCE_HEADFUL === "1";
const referencePresentation = process.env.GLYPHCSS_WEBGPU_PRESENTATION === "1";

export default defineConfig({
  testDir: "./browser",
  fullyParallel: true,
  projects: [{
    name: referenceChromium ? "chromium-reference" : "chromium-local",
    use: {
      browserName: "chromium",
      ...(referenceChromium ? {
        launchOptions: {
          executablePath: referenceChromium,
          ...(referenceHeadful ? { headless: false } : {}),
          args: [
            "--enable-unsafe-webgpu",
            "--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan",
            "--use-angle=vulkan",
            "--use-vulkan=native",
            ...(referencePresentation ? ["--enable-gpu-rasterization"] : ["--disable-vulkan-surface"]),
            "--ignore-gpu-blocklist",
            "--disable-gpu-sandbox",
            "--no-sandbox",
            "--disable-software-rasterizer",
          ],
        },
      } : {}),
    },
  }],
});

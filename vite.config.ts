import { defineConfig } from "vite";

const isGithubActions = process.env.GITHUB_ACTIONS === "true";
const githubRepoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const pagesBase = githubRepoName ? `/${githubRepoName}/` : "/";

export default defineConfig({
  // GitHub Pages hosts the app under /<repo>/, while local dev/build should stay at /.
  base: isGithubActions ? pagesBase : "/",
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});

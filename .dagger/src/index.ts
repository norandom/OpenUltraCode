import { dag, Directory, object, func } from "@dagger.io/dagger"

@object()
export class OpencodeUltracode {
  /**
   * Optional containerized ESLint run (`pnpm run lint:container`). The pre-commit hook and CI run `pnpm run lint` directly.
   */
  @func()
  async lint(source: Directory): Promise<string> {
    return dag
      .container()
      .from("node:24-alpine")
      .withEnvVariable("CI", "true")
      .withExec(["corepack", "enable"])
      // Host node_modules (possibly built for another OS) must not leak into the container.
      .withMountedDirectory("/src", source.withoutDirectory("node_modules").withoutDirectory(".opencode/node_modules"))
      .withWorkdir("/src")
      .withExec(["pnpm", "install", "--frozen-lockfile"])
      .withExec(["pnpm", "run", "lint"])
      .stdout()
  }

  /**
   * Check the release tag format after lint passes. The git tag is created on the host.
   */
  @func()
  async tag(source: Directory, version = "0.1.0"): Promise<string> {
    await this.lint(source)

    const tag = version.startsWith("v") ? version : `v${version}`
    if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
      throw new Error("version must be a semantic version such as 0.1.0 or v0.1.0")
    }

    return tag
  }
}

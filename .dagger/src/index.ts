import { dag, Directory, object, func } from "@dagger.io/dagger"

@object()
export class OpencodeUltracode {
  /**
   * Run ESLint inside a Dagger-managed Node container.
   */
  @func()
  async lint(source: Directory): Promise<string> {
    return dag
      .container()
      .from("node:24-alpine")
      .withEnvVariable("CI", "true")
      .withExec(["corepack", "enable"])
      .withMountedDirectory("/src", source)
      .withWorkdir("/src")
      .withExec(["pnpm", "install", "--frozen-lockfile"])
      .withExec(["pnpm", "run", "eslint"])
      .stdout()
  }

  /**
   * Validate the release tag that should be created after checks pass.
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

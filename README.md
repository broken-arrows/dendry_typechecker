# Dendry Type Checker for VSCode

A Visual Studio Code extension providing type checking and validation for DendryNexys interactive fiction files. This extension is currently in **beta** versioning, expect bugs and incomplete checking and highlighting.

## Features

- **Syntax Highlighting**: Supporting Dendry/DendryNexus' unique syntax, and for JS, HTML, and supported MD-like expressions when relevant.
- **Real-time Validation**: Validates your `.scene.dry` and `.qdisplay.dry` files as you type.
- **Duplicate ID Detection**: Detects when a scene `id` is used more than once across your entire project.
- **JavaScript Validation**: Parses embedded JavaScript (in `on-arrival`, `view-if`, etc.) to find and validate references to scenes (`S.`) and qualities (`Q.`).
- **Reference Validation**: Ensures that all references to scenes in properties like `go-to` point to scenes that actually exist in your project.
- **Variable Casting Validation**: Validates `[+ var +]` and `[+ var : qdisplay +]` syntax within text, as well as referenced `qdisplay` existence.
- **Basic Debugging Support**: Support for F5-run to easily test your DendryNexus project directly from VSCode. _(Desktop only — see "Web support" below.)_
- **Runs in the browser**: Works as a web extension on [github.dev](https://github.dev) and [vscode.dev](https://vscode.dev) — open a repo with `.dry` files and get the same validation, no install or local setup.

## Web support

This extension is published as both a desktop and a **web** extension from a single package, so it also runs in the browser editors ([github.dev](https://github.dev), [vscode.dev](https://vscode.dev)). Note however that due to web development limitations, the "Build and Launch" feature via pressing F5 is **not** supported there. Use desktop VSCode if you need F5 builds.

## Configuration

- `dendry.validation.enable`: Enable/disable validation (default: `true`).
- `dendry.validation.strict`: Enable/disable strict validation mode (default: `false`). For the time being, this only disables warnings regarding repeated scene properties.
- `dendry.validation.exclude`: Glob patterns for files/folders to exclude from DendryNexus validation.
- `dendry.validation.jsLibraries`: An array of strings representing additional global JavaScript variables that should be recognized during validation (default: `["d3"]`). This is useful when your project uses external JavaScript libraries that introduce global variables.
- `dendry.debug.buildCommand`: Command to build the DendryNexus project (default: `npm run dendrynexus make-html -- --pretty`).
- `dendry.debug.outputPath`: Relative path to the built HTML file from workspace root (default: `out/html/index.html`).

## Example

```dendry
title: Beginning
max-visits: 3
on-arrival: visited = true

= Beginning
This is the opening scene.
*what can you do next?*

- @back: Go home
- @continue

@back
new-page: true
go-to: another_scene.elsewhere

@continue
title: Continue
game-over: true
on-arrival: {!
   console.log("Player continued...");
   Q.var = "foo"
!}

[? if visited: <img src="https://media.tenor.com/EMVZYUqX-cgAAAAC/pepe-saber.gif"/> ?]

Game's over :/ - [+ var : foo +]

```

The extension will:

- Provide proper syntax highlighting.
- Validate scene property names and types.
- Check JavaScript syntax when relevant, both on scene qualities (e.g. on-arrival) and in-line conditionals.
- Ensure referenced scenes and subscenes exist.
- Check for valid varible insertion in text, as well as for valid qdisplay casting (e.g. does a file named `foo.qdisplay.dry` exist?)

## Usage

1. Open your project, or any `.scene.dry`/`.qdisplay.dry` file in VSCode.
2. The extension automatically activates and validates your files.
3. Errors and warnings will appear in the "Problems" panel.
4. Hover over the underlined code to see detailed error messages.

## Manual Installation

1. Clone or download this extension.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the bundles with esbuild (required — `dist/` is not tracked in git). This produces both the desktop (`dist/desktop/extension.js`) and web (`dist/web/extension.js`) bundles:

   ```bash
   npm run compile
   ```

4. Press F5 in VSCode to launch an extension development host with the (desktop) extension running.

5. To try the **web** build in a real browser editor host:

   ```bash
   npm run open-in-web
   ```

6. For the packaged extension, use:

   ```bash
   npx vsce package
   ```

   `vsce` runs `vscode:prepublish` for you, which type-checks (`tsc --noEmit`) and produces a fresh minified `dist/`. The resulting `.vsix` is automatically web-enabled because the manifest declares a `browser` entry point.

## Extension Structure

```
dendry-typechecker/
├── package.json                      # Extension manifest (main = desktop, browser = web)
├── esbuild.js                        # Dual desktop/web bundler
├── tsconfig.json                     # TypeScript config (type-checking only)
├── language-configuration.json       # Language settings
├── syntaxes/
│   └── dendry.tmLanguage.json        # Syntax highlighting
└── src/
    ├── extension.ts                  # Desktop entry point (+ F5 build feature)
    ├── extension.web.ts              # Web entry point (github.dev / vscode.dev)
    ├── activate-core.ts              # Shared activation used by both entries
    ├── parser.ts                     # DendryNexus file parser
    ├── project-validator.ts          # Orchestrates project-wide validation
    └── validator.ts                  # Contains the specific validation rules
```

## Contributing & Issue Reporting

Please report any issues via [GitHub Issues](https://github.com/broken-arrows/dendry_typechecker/issues).
When doing so, please do your best to include as much information as possible. I.e.:

- A detailed description of the bug/issue.
- Steps to reproduce it, if applicable.
- Files where the issue was observed (if possible).
- Your extension and vscode versions.

This is a hobby project, and may not actively be maintained at the time. If you want to contribute, please do! Feel free to [open any PR](https://github.com/broken-arrows/dendry_typechecker/pulls) with improvements.

## License

MIT

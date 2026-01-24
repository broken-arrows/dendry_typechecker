# Dendry Type Checker for VSCode

A Visual Studio Code extension providing type checking and validation for Dendry interactive fiction files (.scene.dry).

## Features

- **Real-time Validation**: Validates your `.scene.dry` files as you type, providing immediate feedback.
- **Duplicate ID Detection**: Detects when a scene `id` is used more than once across your entire project.
- **JavaScript Validation**: Parses embedded JavaScript (in `on-arrival`, `view-if`, etc.) to find and validate references to scenes (`S.`) and qualities (`Q.`).
- **Reference Validation**: Ensures that all references to scenes in properties like `go-to` point to scenes that actually exist in your project.
- **Syntax Highlighting**: Comes with a TextMate grammar for `.scene.dry` files to make your code easier to read.

## Configuration

- `dendry.validation.enable`: Enable/disable validation (default: true).
- `dendry.validation.exclude`: Glob patterns for files/folders to exclude from Dendry validation.

## Example

```dendry
title: Beginning
max-visits: 3
on-arrival: Q.visited = true

= Beginning
This is the opening scene.
*what can you do next?*

- @back: Go home
- @continue

@continue
title: Continue
game-over: true
on-arrival: {!
   console.log("Player continued...");
!}

[? if visited: <img src="https://media.tenor.com/EMVZYUqX-cgAAAAC/pepe-saber.gif"/>]

Game's over :(

```

The extension will:

- Validate property names and types
- Check JavaScript syntax in on-arrival
- Ensure next_scene exists

## Usage

1. Open any `.scene.dry` file in VSCode.
2. The extension automatically activates and validates your files.
3. Errors and warnings will appear in the "Problems" panel.
4. Hover over the underlined code to see detailed error messages.

## Installation

1. Clone or download this extension.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Compile TypeScript:

   ```bash
   npm run compile
   ```

4. Press F5 in VSCode to launch an extension development host with the extension running.

## Extension Structure

```
dendry-typechecker/
├── package.json                      # Extension manifest
├── tsconfig.json                     # TypeScript config
├── language-configuration.json       # Language settings
├── syntaxes/
│   └── dendry.tmLanguage.json       # Syntax highlighting
└── src/
    ├── extension.ts                  # Extension entry point
    ├── parser.ts                     # Esprima-based parser for JavaScript
    ├── project-validator.ts          # Orchestrates project-wide validation
    └── validator.ts                  # Contains the specific validation rules
```

## Building for Distribution

```bash
npm install -g vsce
vsce package
```

This creates a `.vsix` file that you can install in VSCode or distribute.

## License

MIT
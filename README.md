# Dendry Type Checker for VSCode

A Visual Studio Code extension providing type checking and validation for Dendry interactive fiction files (.scene.dry).

## Features

- **Robust Real-time Validation**: Provides immediate feedback on your `.scene.dry` files as you type. The extension uses a powerful `chevrotain`-based parser that can gracefully handle syntax errors, providing accurate and easy-to-understand error messages.
- **Duplicate ID Detection**: Automatically detects when a scene or quality `id` is used more than once, both within a single file and across your entire project, preventing common and hard-to-find bugs.
- **Advanced JavaScript Validation**: Goes beyond simple syntax checking. The extension parses your embedded JavaScript (in `on-arrival`, `view-if`, etc.) to intelligently find and validate references to scenes (`S.`) and qualities (`Q.`), including complex cases like `Q['my-quality']`.
- **Comprehensive Type Checking**: Checks that your property values are the correct type (e.g., numbers for `max-visits`, booleans for `new-page`).
- **Reference Validation**: Ensures that all references to scenes in properties like `go-to` point to scenes that actually exist in your project.
- **Syntax Highlighting**: Comes with a TextMate grammar for `.scene.dry` files to make your code easier to read.
- **Configurable Strictness**: Allows you to enable a `strictMode` for more stringent validation rules.

## Configuration

- `dendry.validation.enable`: Enable/disable validation (default: true)
- `dendry.validation.strictMode`: Enable strict type checking (default: false)

## Validation Features

### Scene Validation

- Required `id` property
- Valid property names (id, title, tags, max-visits, etc.)
- Numeric type checking for frequency, order, priority
- JavaScript validation in on-* properties
- Scene reference validation in go-to

### Quality Validation

- Required `id` property
- Numeric type checking for initial, min, max values
- Min/max constraint validation

### Choice Validation

- Property name validation
- JavaScript validation in conditional properties
- Scene reference validation

### JavaScript Type Checking

- Syntax validation using Function constructor

## Usage

1. Open any `.scene.dry` file in VSCode
2. Extension automatically activates and validates
3. Errors and warnings appear in Problems panel
4. Hover over underlined code for details

## Example

```dendry
@scene start
id: start
title: Beginning
max-visits: 3
on-arrival: Q.visited = true

This is the opening scene.

- Continue onwards
  go-to: next_scene
```

The extension will:

- Validate property names and types
- Check JavaScript syntax in on-arrival
- Ensure next_scene exists

## Installation

1. Clone or download this extension
2. Install dependencies:

   ```bash
   npm install
   ```

3. Compile TypeScript:

   ```bash
   npm run compile
   ```

4. Press F5 in VSCode to launch extension development host

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
    ├── lexer.ts                      # Chevrotain lexer for tokenizing
    ├── parser.ts                     # Chevrotain parser and CST-to-AST visitor
    ├── project-validator.ts          # Orchestrates project-wide validation
    └── validator.ts                  # Contains the specific validation rules
```

## Building for Distribution

```bash
npm install -g vsce
vsce package
```

This creates a `.vsix` file you can install or distribute.

## License

MIT
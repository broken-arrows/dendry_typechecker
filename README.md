# Dendry Type Checker for VSCode

A Visual Studio Code extension providing type checking and validation for Dendry interactive fiction files (.scene.dry).

## Features

- **Real-time validation** of Dendry scene, quality, and choice declarations
- **Type checking** for property values (numbers, strings, JavaScript expressions)
- **JavaScript syntax validation** for on-arrival, on-display, view-if, choose-if properties
- **Reference validation** for scene IDs and quality references
- **Syntax highlighting** for .scene.dry files
- **Configurable strictness** with strict mode option

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
    ├── parser.ts                     # Dendry file parser
    └── validator.ts                  # Type checker & validator
```

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
- Quality reference checking (Q.qualityName)
- Undefined quality warnings

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
- Verify Q.visited references a defined quality
- Ensure next_scene exists

## Building for Distribution

```bash
npm install -g vsce
vsce package
```

This creates a `.vsix` file you can install or distribute.

## License

MIT
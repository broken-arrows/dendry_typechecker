# GEMINI.md - Dendry Type Checker VS Code Extension

This document provides a comprehensive overview of the Dendry Type Checker VS Code extension, its architecture, and its features. It is intended for developers who want to understand, contribute to, or maintain the extension.

## Project Overview

The Dendry Type Checker is a VS Code extension that provides real-time validation, type checking, and syntax highlighting for Dendry, an open-source framework for creating interactive fiction. The extension helps authors of Dendry projects to write valid and error-free code by providing immediate feedback on their `.scene.dry` files.

## How it Works

The extension's core functionality is centered around a project-wide validation system. When a workspace is opened, the extension finds all `.scene.dry` files and builds a model of the entire project. This model includes all the scenes, qualities, and other entities defined in the project.

The validation process consists of the following steps:

1.  **File Parsing:** Each `.scene.dry` file is parsed into a Concrete Syntax Tree (CST) using a robust, error-tolerant parser built with the `chevrotain` library. The CST is then transformed into an Abstract Syntax Tree (AST) that represents the structure of the file. This approach allows for detailed error reporting even in partially invalid files.
2.  **ID Extraction and Duplicate Detection:** Scene and quality IDs are extracted from each file's AST. The extension performs two levels of duplicate ID checks:
    *   **In-file duplicates:** It flags any ID that is defined more than once within the same file.
    *   **Cross-file duplicates:** It identifies IDs that are defined in multiple files across the project, which is a critical source of errors in larger Dendry projects.
3.  **Validation:** Each file's AST is then validated against the global collection of IDs, as well as a set of predefined rules for Dendry syntax and semantics. This includes advanced validation of JavaScript expressions.
4.  **Diagnostics:** Any errors or warnings found during the validation process are displayed in the VS Code Problems panel, with precise location information derived from the parser.

The extension is designed to be efficient by caching the parsed ASTs and only re-validating the files that have been changed.

## Key Features

-   **Real-time Validation:** Provides immediate feedback on Dendry files as they are created or modified.
-   **Robust Parsing:** Uses a `chevrotain`-based parser that can handle syntax errors gracefully and provide detailed error messages.
-   **Duplicate ID Detection:** Checks for duplicate scene and quality IDs both within the same file and across the entire project.
-   **Advanced JavaScript Validation:** Instead of simple regex checks, the extension now parses embedded JavaScript code into an AST using `esprima`. This allows for much more reliable validation of references to scenes (`S.`) and qualities (`Q.`), including computed properties (e.g., `Q['my-quality']`).
-   **Type Checking:** Checks the types of property values to ensure they are of the correct type (e.g., number, string, boolean).
-   **Reference Checking:** Ensures that all references to scenes and qualities are valid and point to existing entities.
-   **Syntax Highlighting:** Provides syntax highlighting for `.scene.dry` files.
-   **Configurable Strictness:** Allows users to configure the strictness of the validation rules.


## Project Structure

The project is organized into the following main directories and files:

-   `src/`: Contains the TypeScript source code for the extension.
    -   `extension.ts`: The entry point of the extension, responsible for activating and deactivating the extension, and for registering the event listeners.
    -   `lexer.ts`: Contains the `chevrotain` lexer and the definitions for all the tokens used in the Dendry syntax.
    -   `parser.ts`: Contains the `chevrotain`-based parser that defines the grammar for Dendry files. It also includes the CST-to-AST visitor that converts the parsed output into a more usable format.
    -   `project-validator.ts`: The core of the validation logic, responsible for orchestrating the parsing and validation of the entire project. It also contains the logic for detecting duplicate IDs across files.
    -   `validator.ts`: Contains the specific validation rules for scenes, qualities, and choices, including the advanced JavaScript validation logic.
-   `syntaxes/`: Contains the TextMate grammar for Dendry syntax highlighting.
-   `package.json`: The extension manifest file, which contains metadata about the extension, its dependencies, and its contributions to VS Code.

## Validation Logic

The validation logic is implemented in the `DendryValidator` class in `src/validator.ts`. This class defines the valid properties for scenes, qualities, and choices, and it checks the types of the property values.

The validator performs the following checks:

-   **Scene Validation:**
    -   Ensures that each scene has a unique ID (checked in `project-validator.ts`).
    -   Validates the property names and types.
    -   Checks for references to undefined scenes in `go-to` and `set-jump` properties.
-   **Quality Validation:**
    -   Ensures that each quality has a unique ID (checked in `project-validator.ts`).
    -   Validates the property names and types.
    -   Checks for min/max constraints.
-   **Choice Validation:**
    -   Validates the property names and types.
    -   Checks for references to undefined scenes.
-   **JavaScript Validation:**
    -   Validates the syntax of JavaScript code using Esprima.
    -   Walks the JavaScript AST to find and validate references to qualities (`Q.*`) and scenes (`S.*`).

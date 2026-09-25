# Part 1: UX Polish, Miro Presets, Link Previews, Fonts & Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement user feedback improvements: explicit shape selection menu, AI Cookbook re-labeling, 1-click Miro Whiteboard background presets, Open Graph image preview cards for pasted links, typography/font options for canvas items, and Revit-style simplified starter views in onboarding.

**Architecture:** 
- Shared domain models (`wallModel.ts`, `linkPreview.ts`) are augmented with backwards-compatible optional properties (`font`, `previewImage`) and entity parsing.
- Main process (`linkPreview.ts`) extracts Open Graph / Twitter image tags, downloads & caches images into the local media store with strict size and safety guards.
- Renderer components (`WallToolbar.tsx`, `WallSelectionBar.tsx`, `WallBackgroundMenu.tsx`, `WallItemView.tsx`, `Sidebar.tsx`, `OnboardingTour.tsx`) expose accessible, intuitive controls replacing confusing click-cycling and hardcoded styling.

**Tech Stack:** React 18, TypeScript, Electron, Vitest, Lucide React, CSS Variables.

---

## Task 1: Explicit Shape Picker (Toolbar & Selection Bar)

**Files:**
- Modify: `src/renderer/src/components/wall/wallButtons.tsx`
- Modify: `src/renderer/src/components/wall/WallToolbar.tsx`
- Modify: `src/renderer/src/components/wall/WallSelectionBar.tsx`
- Modify: `tests/wallShape.test.ts`

- [ ] **Step 1: Write tests for shape helper and options**
  Add unit tests in `tests/wallShape.test.ts` verifying all 5 supported shapes (`rectangle`, `rounded`, `oval`, `diamond`, `triangle`) have readable display names and corresponding outline paths.
- [ ] **Step 2: Create `ShapePickerPopover` component in `wallButtons.tsx`**
  Instead of single-click cycling where users don't know other shapes exist, create a clean popover menu displaying all 5 shapes with their SVG outline glyphs and labels.
- [ ] **Step 3: Update `WallToolbar.tsx` shape button**
  Add a dropdown/popover trigger on the Shape tool so users can either click the active shape or open the menu to pick a specific shape directly.
- [ ] **Step 4: Update `WallSelectionBar.tsx`**
  Replace `shapeButton` cycling with a direct popover picker that lets the user choose any of the 5 shapes with one click.
- [ ] **Step 5: Run tests and verify**
  Run `npx vitest run tests/wallShape.test.ts`.

---

## Task 2: Rename "Cookbook" to "AI Cookbook"

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/lib/features.ts`
- Modify: `src/renderer/src/components/CookbookView.tsx`

- [ ] **Step 1: Update navigation label in `Sidebar.tsx`**
  Change the sidebar label from `'Cookbook'` to `'AI Cookbook'`.
- [ ] **Step 2: Update feature descriptor in `features.ts`**
  Change feature label to `'AI Assistant Cookbook'` and ensure tooltip clarity.
- [ ] **Step 3: Update title & headers in `CookbookView.tsx`**
  Ensure the page heading and descriptions clearly say "AI Cookbook" so new users immediately know it holds AI prompts and local models, not cooking recipes.
- [ ] **Step 4: Run typecheck and verify**
  Run `npm run typecheck`.

---

## Task 3: Miro / Whiteboard Quick Canvas Presets

**Files:**
- Modify: `src/shared/wallModel.ts`
- Modify: `src/renderer/src/components/wall/WallBackgroundMenu.tsx`
- Modify: `src/renderer/src/components/wall/WallCanvas.tsx`
- Modify: `tests/boardBackground.test.ts`

- [ ] **Step 1: Add canvas preset constants in `wallModel.ts`**
  Define `WALL_CANVAS_PRESETS`:
  - `Miro White` (`#ffffff`)
  - `Off-White Canvas` (`#f8f9fa`)
  - `Warm Paper` (`#fdfbf7`)
  - `Dark Board` (`#18181b`)
- [ ] **Step 2: Add quick-preset buttons in `WallBackgroundMenu.tsx`**
  Add a dedicated "Canvas Presets" section at the top of the background popover with 1-click preset chips for *Miro White*, *Warm Paper*, *Dark Board*, and *Follow Theme*.
- [ ] **Step 3: Test background setting and custom colors**
  Run `npx vitest run tests/boardBackground.test.ts` and ensure theme variables and canvas background colors blend seamlessly.

---

## Task 4: Rich Link Previews with Images (Miro-style Bookmark Cards)

**Files:**
- Modify: `src/shared/linkPreview.ts`
- Modify: `src/main/linkPreview.ts`
- Modify: `src/shared/wallModel.ts`
- Modify: `src/renderer/src/components/wall/useWallDocument.ts`
- Modify: `src/renderer/src/components/wall/WallItemView.tsx`
- Modify: `tests/linkPreview.test.ts`

- [ ] **Step 1: Update `parseLinkPreview` to extract `og:image` and `twitter:image`**
  In `src/shared/linkPreview.ts`, parse `og:image` and `twitter:image` tags from HTML `<meta>` tags and resolve absolute URLs.
- [ ] **Step 2: Add tests in `tests/linkPreview.test.ts`**
  Add unit tests verifying `og:image` and `twitter:image` extraction and URL resolution.
- [ ] **Step 3: Download and cache preview image in `src/main/linkPreview.ts`**
  When `imageUrl` is present in preview, fetch the image (with timeout and 2MB size cap) and save to media storage via `saveBufferToMedia`. Return the media reference in `PagePreview.image`.
- [ ] **Step 4: Store preview image on `WallItem`**
  Add optional `previewImage?: string` to `WallItem` in `src/shared/wallModel.ts`, with normalization in `normalizeWallItem`.
- [ ] **Step 5: Update `WallItemView.tsx` bookmark layout**
  When `item.kind === 'bookmark'`, render a thumbnail banner image (`checkpoint-media://${item.previewImage}`) above the title/host if available, giving the exact Miro bookmark card experience.
- [ ] **Step 6: Run tests and verify**
  Run `npx vitest run tests/linkPreview.test.ts`.

---

## Task 5: Typography / Font Selection for Wall Items

**Files:**
- Modify: `src/shared/wallModel.ts`
- Modify: `src/renderer/src/components/wall/WallSelectionBar.tsx`
- Modify: `src/renderer/src/components/wall/WallItemView.tsx`
- Modify: `tests/wallTextStyle.test.ts`

- [ ] **Step 1: Define `WALL_FONTS` in `src/shared/wallModel.ts`**
  Add `export const WALL_FONTS = ['sans', 'serif', 'mono', 'handwriting'] as const` and `export type WallFont = (typeof WALL_FONTS)[number]`.
  Add `font?: WallFont` to `WallItem` and normalize in `normalizeWallItem`.
- [ ] **Step 2: Add unit tests in `tests/wallTextStyle.test.ts`**
  Verify `font` normalization on sticky notes, text, and shapes, and ensure invalid fonts fall back safely.
- [ ] **Step 3: Add Font selector in `WallSelectionBar.tsx`**
  When `wordsSelected` is true, render a font selection button/popover allowing switching between Sans, Serif, Mono, and Handwritten.
- [ ] **Step 4: Apply font styling in `WallItemView.tsx`**
  Map `item.font` to CSS `fontFamily` for notes, text boxes, and shapes.
- [ ] **Step 5: Run tests**
  Run `npx vitest run tests/wallTextStyle.test.ts`.

---

## Task 6: Simplified / Revit-Style Starter Views (Onboarding Profile)

**Files:**
- Modify: `src/renderer/src/components/OnboardingTour.tsx`
- Modify: `src/renderer/src/lib/features.ts`

- [ ] **Step 1: Add Starter Profile options to Onboarding**
  In `OnboardingTour.tsx`, add a view customization step:
  - **Option A (Focused / Clean)**: Enables Kanban, Wall, Notes, Focus (hiding raw Log and advanced developer tools).
  - **Option B (Full Suite / Power User)**: Enables all views.
- [ ] **Step 2: Apply selected view profile on tour completion**
  Save the user's chosen view features into settings, with a message reminding them they can re-enable any view in Settings at any time.
- [ ] **Step 3: Verification**
  Run `npm run verify` to ensure typecheck, lint, test, and build succeed.

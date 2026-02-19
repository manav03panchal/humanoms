# HumanOMS Frontend Design Specification

**Design philosophy**: Dieter Rams meets Apple. Less, but better.
**Last updated**: 2026-02-19

---

## 1. Typography

### Font Stack

**Primary**: **Satoshi** (Variable weight, from Fontshare CDN)

```html
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@300,400,500,700&display=swap" rel="stylesheet">
```

**Monospace**: **JetBrains Mono** (from Google Fonts CDN)

```html
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### Type Scale

| Token          | Size  | Weight | Line Height | Usage                              |
|----------------|-------|--------|-------------|------------------------------------|
| `--text-xs`    | 11px  | 400    | 1.4         | Badges, labels, timestamps         |
| `--text-sm`    | 12px  | 400    | 1.5         | Tool calls, secondary info         |
| `--text-base`  | 13px  | 400    | 1.6         | Body text, messages, inputs        |
| `--text-md`    | 14px  | 500    | 1.5         | Top bar title, card headers        |
| `--text-lg`    | 16px  | 600    | 1.4         | Headings in messages (h3)          |
| `--text-xl`    | 20px  | 600    | 1.3         | Welcome title, login heading       |
| `--text-2xl`   | 24px  | 700    | 1.2         | Reserved (large headings if needed)|

### Font Family Variables

```css
--font-sans: 'Satoshi', -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', 'SF Mono', monospace;
```

---

## 2. Color System

### Design Principles

- Minimal palette: background, two surface layers, border, text, muted, one accent
- Accent color: **warm amber** (`#D4915C` dark / `#B8784A` light) -- not blue, not purple
- Dark mode is the primary mode; light mode is the secondary
- All colors via CSS custom properties for instant theme switching

### Dark Theme (default)

```css
[data-theme="dark"], :root {
  --bg:        #0C0C0C;
  --surface:   #141414;
  --surface-2: #1C1C1C;
  --border:    #2A2A2A;
  --text:      #E8E4DF;
  --muted:     #6B6660;
  --accent:    #D4915C;
  --accent-fg: #0C0C0C;
  --success:   #5A9A6B;
  --warning:   #C4993D;
  --error:     #C45454;
}
```

### Light Theme

```css
[data-theme="light"] {
  --bg:        #FAFAF8;
  --surface:   #F0EFED;
  --surface-2: #E6E5E2;
  --border:    #D4D3D0;
  --text:      #1A1918;
  --muted:     #8A8580;
  --accent:    #B8784A;
  --accent-fg: #FAFAF8;
  --success:   #4A8A5B;
  --warning:   #A47F30;
  --error:     #B04040;
}
```

### Color Usage Map

| Token        | Usage                                                      |
|--------------|------------------------------------------------------------|
| `--bg`       | Page background, message list background                   |
| `--surface`  | Top bar, input area, tool call blocks, cards, login box    |
| `--surface-2`| Inputs, code blocks, card headers, hover states            |
| `--border`   | All borders (1px solid), dividers, separators              |
| `--text`     | Primary text, headings, strong emphasis                    |
| `--muted`    | Secondary text, labels, timestamps, placeholders           |
| `--accent`   | Send button, active states, links, accent badges           |
| `--accent-fg`| Text on accent-colored backgrounds                         |
| `--success`  | Tool call "done" status dot                                |
| `--warning`  | Tool call "running" status dot                             |
| `--error`    | Error messages, destructive action text                    |

---

## 3. Spacing System

Base unit: **4px**. All spacing uses multiples of 4.

| Token    | Value | Usage                                      |
|----------|-------|--------------------------------------------|
| `--sp-1` | 4px   | Tight gaps (inline badge padding)          |
| `--sp-2` | 8px   | Small gaps (between tool call elements)    |
| `--sp-3` | 12px  | Medium gaps (input padding, card padding)  |
| `--sp-4` | 16px  | Standard gaps (message bubble padding)     |
| `--sp-5` | 20px  | Section spacing (between messages)         |
| `--sp-6` | 24px  | Container padding (message list sides)     |
| `--sp-8` | 32px  | Large spacing (login box padding)          |
| `--sp-10`| 40px  | XL spacing (welcome section)               |

### Border Radius

| Token       | Value | Usage                              |
|-------------|-------|------------------------------------|
| `--radius-sm` | 4px  | Badges, small elements             |
| `--radius`    | 6px  | Buttons, inputs, cards, tool calls |
| `--radius-lg` | 12px | User message bubbles               |
| `--radius-xl` | 16px | Login box                          |

### Content Width

```css
--content-max: 720px;
```

All messages and the input bar are constrained to this width, centered.

---

## 4. Component Specifications

### 4.1 Top Bar

```
+-------------------------------------------------------------+
| HumanOMS              [sun/moon]  [+ New]  [LogOut]          |
+-------------------------------------------------------------+
```

- **Height**: 48px
- **Background**: `var(--surface)`
- **Border**: bottom 1px `var(--border)`
- **Padding**: 0 var(--sp-6)
- **Left**: App name in `--text-md`, weight 600, color `var(--text)`, letter-spacing -0.01em
- **Right**: icon buttons, 32x32px each, `var(--muted)` color, `var(--text)` on hover
  - Buttons are icon-only (no text labels) with 6px gap between them
  - Hover: background `var(--surface-2)`, border-radius `var(--radius)`
- **Theme toggle**: Sun icon in light mode, Moon icon in dark mode
- **New Chat**: Plus icon
- **Logout**: LogOut icon

### 4.2 Message List

- **Container**: `flex: 1; overflow-y: auto;`
- **Padding**: `var(--sp-6) 0` top and bottom
- **Each message**: max-width `var(--content-max)`, centered with auto margins
- **Message spacing**: `var(--sp-5)` between messages (20px)

### 4.3 User Messages

```
                                        +------------------+
                                        | Message text     |
                                        +------------------+
```

- **Alignment**: right-aligned (`margin-left: auto;`)
- **Background**: `var(--surface-2)` (NOT the accent color -- subtle, not heavy)
- **Color**: `var(--text)`
- **Padding**: `10px 16px`
- **Border-radius**: `var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg)` (bottom-right is sharp)
- **Max-width**: 85% of content column
- **Font**: `var(--text-base)`, weight 400
- **No border**. Just the subtle surface background is enough.

### 4.4 Assistant Messages

```
Tool call indicator (collapsed)
Tool call indicator (collapsed)

Response text in clean typography,
rendered as markdown on the page background.
```

- **Alignment**: left-aligned, full width
- **Background**: none (text sits directly on `var(--bg)`)
- **Color**: `var(--text)`
- **Line height**: 1.65
- **Markdown elements**:
  - `h1`: 16px, weight 600, margin 16px 0 8px
  - `h2`: 15px, weight 600, margin 12px 0 6px
  - `h3`: 14px, weight 600, margin 10px 0 4px
  - `p`: margin 6px 0
  - `code` (inline): `var(--surface-2)` bg, 2px 5px padding, `var(--radius-sm)` radius, `var(--font-mono)` at 12px
  - `pre` (code block): `var(--surface)` bg, 1px `var(--border)` border, `var(--radius)` radius, 14px padding, `var(--font-mono)` at 12px
  - `strong`: weight 600, color `var(--text)`
  - `table`: full width, collapse borders, `var(--text-sm)` font, `th` has `var(--surface-2)` bg
  - `ul/ol`: 20px left padding, 3px between items

### 4.5 Tool Call Indicators

```
> search_tasks                                           done
> execute_workflow                                    running
```

- **Collapsed state** (default): single line, 32px height
  - Left: chevron icon (8px), tool name in `var(--font-mono)` at 11px, color `var(--accent)`
  - Right: status text -- "done" in `var(--success)`, "running..." in `var(--warning)`
  - Background: `var(--surface)`
  - Border: 1px `var(--border)`, `var(--radius)` radius
  - Margin: 4px 0 between consecutive tool calls
  - Cursor: pointer on the entire row
  - Hover: border-color transitions to `var(--muted)`

- **Expanded state**: shows input/result below the header
  - Expansion area: `var(--surface)` bg, border-top 1px `var(--border)`
  - Label ("Input" / "Result"): `var(--text-xs)`, uppercase, `var(--muted)`, letter-spacing 0.5px
  - Content: `var(--font-mono)` at 11px, `var(--muted)` color, pre-wrap
  - Max-height: 300px with overflow-y auto
  - Chevron rotates 90deg when expanded

### 4.6 Rich Data Cards

```
+-------------------------------------------------------------+
| Task Title                                  [status badge]   |
+-------------------------------------------------------------+
| Priority        [priority badge]                             |
| Due             2026-02-20                                   |
| Description     Short description text                       |
+-------------------------------------------------------------+
```

- **Container**: 1px `var(--border)` border, `var(--radius)` radius, `var(--surface)` bg
- **Header**: `var(--surface-2)` bg, border-bottom 1px, padding 8px 12px
  - Title: `var(--text-md)`, weight 500, truncate with ellipsis
  - Badge: right-aligned
- **Body**: padding 8px 12px
  - Rows: flex between, 4px vertical padding each
  - Labels: `var(--muted)`, `var(--text-sm)`
  - Values: `var(--text)`, `var(--text-sm)`
- **Margin**: 8px 0 between cards

### 4.7 Input Bar

```
+-------------------------------------------------------------+
| [textarea placeholder text...                         ] [^]  |
+-------------------------------------------------------------+
```

- **Container**: background `var(--bg)` (blends with page), border-top 1px `var(--border)`, max-width `var(--content-max)` centered, padding `12px var(--sp-6) 16px`
- **Textarea**:
  - Background: `var(--surface)`
  - Border: 1px `var(--border)`, radius `var(--radius-lg)`
  - Padding: 10px 14px
  - Min-height: 40px, max-height: 150px
  - Resize: none (auto-grows)
  - Font: `var(--font-sans)`, `var(--text-base)`
  - Placeholder color: `var(--muted)`
  - Focus: border-color transitions to `var(--accent)`, no box-shadow (clean)
- **Send button**:
  - Size: 36x36px
  - Background: `var(--accent)`
  - Color: `var(--accent-fg)`
  - Border-radius: `var(--radius)`
  - Icon: ArrowUp (Lucide), 16x16px
  - Hover: opacity 0.9
  - Disabled: opacity 0.3
  - Transition: opacity 150ms

### 4.8 Login Screen

```
          +-------------------------+
          |                         |
          |  HumanOMS               |
          |  Enter your API key     |
          |                         |
          |  [__________________]   |
          |                         |
          |  [     Login        ]   |
          |                         |
          +-------------------------+
```

- **Gate**: full height, centered flex
- **Box**: width 360px, `var(--surface)` bg, 1px `var(--border)` border, `var(--radius-xl)` radius, `var(--sp-8)` padding
- **Heading**: `var(--text-xl)`, weight 600, `var(--text)` color
- **Subtitle**: `var(--text-base)`, `var(--muted)` color, margin-bottom 20px
- **Input**: full width, same as global input styles
- **Button**: full width, 36px height, `var(--accent)` bg, `var(--accent-fg)` text, weight 500, `var(--radius)` radius
- **Error text**: `var(--error)`, `var(--text-sm)`, margin-bottom 8px

### 4.9 Welcome State (Empty Chat)

```
              HumanOMS

    Your personal task orchestration
    assistant. Ask me to manage tasks,
    create workflows, or check status.
```

- Centered both axes in the message list area
- Title: `var(--text-xl)`, weight 600, `var(--text)`, letter-spacing -0.02em
- Subtitle: `var(--text-base)`, `var(--muted)`, max-width 400px, line-height 1.65
- Gap between title and subtitle: var(--sp-2)

### 4.10 Typing Indicator

```
...
```

- Three dots, 4px diameter, `var(--muted)` color
- Staggered opacity animation (0.3 to 1.0), 1.4s cycle
- Positioned at the start of a message slot (same left alignment as assistant messages)

### 4.11 Toasts

- Fixed bottom-right, 16px from edges
- Background: `var(--surface)`, 1px `var(--border)` border
- Left accent bar: 3px solid, color matches toast type (success/error/warning/info)
- Font: `var(--text-sm)`
- Border-radius: `var(--radius)`
- Max-width: 320px
- Animation: fade-in + slide-up (200ms)

### 4.12 Theme Toggle

- Stores preference in `localStorage` key `humanoms_theme`
- Default: `dark`
- On toggle: set `data-theme` attribute on `<html>` element
- All color transitions: 200ms ease (applied via `transition: background-color 200ms, color 200ms, border-color 200ms`)
- Icon swaps between Sun and Moon (Lucide)

---

## 5. Icon Usage Map

All icons from **Lucide** (https://lucide.dev). Loaded as inline SVGs (same pattern as current send button).

| Location            | Icon Name          | Size   | Color          |
|---------------------|--------------------|--------|----------------|
| Send button         | `ArrowUp`          | 16x16  | `var(--accent-fg)` |
| New chat button     | `Plus`             | 16x16  | `var(--muted)` |
| Theme toggle (dark) | `Sun`              | 16x16  | `var(--muted)` |
| Theme toggle (light)| `Moon`             | 16x16  | `var(--muted)` |
| Logout              | `LogOut`           | 16x16  | `var(--muted)` |
| Tool call chevron   | `ChevronRight`     | 12x12  | `var(--muted)` |
| Tool call expanded  | `ChevronRight` (rotated 90deg) | 12x12 | `var(--muted)` |
| Status: running     | Dot (CSS circle)   | 6x6    | `var(--warning)`|
| Status: done        | Dot (CSS circle)   | 6x6    | `var(--success)`|

Icon buttons share a common class `.icon-btn`:

```css
.icon-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius);
  color: var(--muted);
  cursor: pointer;
  transition: background-color 150ms, color 150ms;
}
.icon-btn:hover {
  background: var(--surface-2);
  color: var(--text);
}
.icon-btn svg {
  width: 16px;
  height: 16px;
}
```

---

## 6. Animation Specifications

| Element              | Property                      | Duration | Easing     | Notes                          |
|----------------------|-------------------------------|----------|------------|--------------------------------|
| Message appear       | opacity 0->1, translateY 4->0 | 200ms    | ease-out   | Applied via `.msg-enter` class |
| Theme colors         | background, color, border     | 200ms    | ease       | Global transition on all themed elements |
| Tool call expand     | max-height 0->auto            | 150ms    | ease       | Use `grid-template-rows: 0fr -> 1fr` for smooth height |
| Tool call chevron    | transform rotate(0->90deg)    | 150ms    | ease       | CSS transition on transform    |
| Toast appear         | opacity 0->1, translateY 8->0 | 200ms    | ease-out   | `@keyframes toast-in`          |
| Send button hover    | opacity                       | 150ms    | linear     | Simple opacity dim             |
| Input focus          | border-color                  | 150ms    | ease       | Subtle accent border           |
| Typing dots          | opacity 0.3->1.0              | 1400ms   | ease       | Staggered 200ms per dot        |

### Keyframes

```css
@keyframes msg-enter {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes typing-blink {
  0%, 60%, 100% { opacity: 0.3; }
  30%           { opacity: 1; }
}
```

**Rules**: No bouncy easing. No playful motion. No gratuitous animation. Every animation serves readability (content entering view) or feedback (state change).

---

## 7. Mobile Responsive Breakpoints

### Breakpoint: 768px (tablet/phone)

```css
@media (max-width: 768px) {
  /* Top bar */
  .top-bar { padding: 0 var(--sp-4); }

  /* Messages */
  .message { padding: 0 var(--sp-4); }

  /* User messages: reduce left offset */
  .message-user { padding-left: var(--sp-10); }

  /* Input bar */
  .input-bar { padding: 10px var(--sp-4) 14px; }
}
```

### Breakpoint: 480px (small phone)

```css
@media (max-width: 480px) {
  .message-user { padding-left: var(--sp-6); }

  .login-box { width: calc(100% - 32px); max-width: 360px; }

  .top-bar-title { font-size: 13px; }
}
```

### Touch Targets

- All interactive elements: minimum 32x32px touch target
- Buttons and icon buttons already meet this (32px height/width)
- Send button: 36x36px

---

## 8. Scrollbar Styling

```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--muted); }
```

Thin, unobtrusive, matches the minimal aesthetic.

---

## 9. Global Resets and Base Styles

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { height: 100%; }
body {
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  transition: background-color 200ms ease, color 200ms ease;
}
```

---

## 10. File Structure (No Changes)

The existing file structure remains:

```
web/
  index.html          -- CSS + shell HTML
  app.js              -- Preact app root, login, chat view, SSE
  api.js              -- fetch wrapper
  lib/preact.js       -- Preact + HTM CDN bundle
  components/
    chat.js           -- MessageList, InputBar, ToolCallBlock, etc.
    cards.js          -- TaskCard, WorkflowCard, etc.
    toast.js          -- Toast system
```

No new files needed. All CSS lives in `index.html <style>`. All icons are inline SVGs in component render functions.

---

## 11. Summary of Changes from Current Design

| Aspect               | Current                          | New                                     |
|----------------------|----------------------------------|-----------------------------------------|
| Font                 | System / Inter                   | Satoshi + JetBrains Mono                |
| Accent color         | Blue `#4c8dff`                   | Warm amber `#D4915C`                    |
| Background           | `#0a0c10` (blue-tinted)          | `#0C0C0C` (pure dark)                   |
| Light mode           | None                             | Full light theme with toggle            |
| User message bg      | Blue accent bubble               | Subtle `var(--surface-2)` (neutral)     |
| Top bar buttons      | Text ghost buttons               | Icon-only buttons                       |
| Icons                | One inline SVG (send)            | Lucide icon set (6 icons)               |
| Message animation    | None                             | Subtle fade-in + slide (200ms)          |
| Tool call status     | Text ("done" / "running...")     | Dot indicator + text                    |
| Input container bg   | `var(--surface)`                 | `var(--bg)` (blends with page)          |
| Overall palette      | Cool blue-gray tones             | Warm neutral tones (amber accent)       |

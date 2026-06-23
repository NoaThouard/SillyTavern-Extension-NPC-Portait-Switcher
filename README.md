# Author

I'm a ros2/c++ programmer so this JS and CSS was 99% vibe-coded. 
May conflict with other extensions that add images/containers to the right of the chat.

# NPC Portrait Switcher

A lightweight SillyTavern extension for narrator/DM setups. When your DM character's message contains an NPC's name (or any keyword you define), their portrait automatically appears in the side expression panel. When

## Installation

1. In SillyTavern, open the **Extensions** panel (puzzle-piece icon)
2. Click **Install extension**
3. Paste the URL of this repository, or manually copy this folder into:
   ```
   SillyTavern/public/scripts/extensions/third-party/npc-portrait-switcher/
   ```
4. Reload SillyTavern

## Setup

1. Open the **Extensions** panel and find **NPC Portrait Switcher**
2. Click **+ Add NPC** for each character you want
3. Type the keyword to watch for (e.g. the NPC's name: `Theron`)
4. Upload their portrait image (PNG, JPG, WebP all work)
5. Optionally set a **Sticky duration** — how many seconds the portrait lingers before fading (0 = stays until the next NPC appears)
6. Optionally upload expression portraits triggered by NPC keyword + Expression Keyword

## How it works

- After every AI message, the extension scans the text fportraitor your keywords
- First match wins — if `Theron` and `Elara` are both in the message, whichever keyword appears first in your list is shown
   - If expression keyword is detected, will load that expression variable.
- The portrait appears in the same side panel used by Character Expressions (`#expression-holder`)
- Keyword matching is case-insensitive by default (toggle in settings)

## Example:

"[DM]: {{char}} looks at you"\
*Default {{char}} portrait will display on the right side of the chat

"[DM]: {{char}} looks at you hot with anger"\
*Default {{char}} 'angry' portrait will display on the right side of the chat*

## Tips

- Works best with Visual Novel Mode enabled (side panel is more prominent)
- You can add multiple keywords per NPC by adding separate entries pointing to the same image
- Portrait is cleared on chat switch

## Notes

- Images are stored as base64 inside SillyTavern's settings — keep portraits reasonably sized (under ~500KB) to avoid bloating settings
- If you use Character Expressions for your DM character, the NPC portrait will temporarily override it while sticky, then the DM's own expression resumes

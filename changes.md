## Version 1.2.0

### New Features

- Added custom mod/skin file import functionality
  - Support for .wad, .zip, and .fantome file formats
  - Custom preview image selection
  - Automatic file validation before import
- Added edit and delete functionality for custom mods
  - Edit button to change mod name and preview image
  - Delete button with confirmation dialog
  - Visual indicators for custom/user-imported skins
- Added downloaded skins management dialog
  - View all downloaded skins organized by champion
  - Search functionality to find specific skins
  - Filter by category (All/Repository/Custom)
  - One-click delete for any downloaded skin
  - Shows total count and skin type indicators

### Improvements

- Enhanced UI for custom mods with edit/delete buttons
- Better visual distinction between repository skins and user imports
- Improved error handling and user feedback messages
- Added loading states for delete operations

### Bug Fixes

- Fixed cslol-tools must be reinstalled every new updates
- Fixed delete functionality for custom mods
- Fixed TypeScript compilation errors
- Fixed ESLint warnings and unused code
- Fixed custom skin image loading in selected skins drawer

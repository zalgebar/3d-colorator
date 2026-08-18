# SeedSigner Designer Fork/Revisions

- 3D Print Coloring

## New Features

Enclosures
- Enclosure list should be a drop-down.

Colors
- Main Color list is now default across the entire app, not per piece.
- Colors can be added to an individual piece based on the system-wide color list.
- Creating new colors should be done by the main, while pieces draw their selectable list as a subset of the main color list.

Pieces
- (admin) Be able to duplicate STLs in the build designer so that the admin-designed build will have multiple instances of a single STL.

Piece Linking
- (admin) Be able to link two or more Pieces together (they will always share the same color).
- (admin) Be able to keep linked pieces separate or collapse them together under one item in the list of Pieces for the user.

Colors
- Colors now have names (allow ?design to manually type a color name)
- Colors now have translucent as an option (allow ?design to select the opacity %)
- Piece color swatches is now a Dropdown list displaying swatch & name.

## Sharing
- SeedSigner Enclosures are now a "Print" a SeedSigner enclosure is a Print.
- SeedSigner Designer is now a subset of Prints (only seedsigners) and allows the user to only pick from SeedSigner Enclosure prints
- Sharing can be done via link now as well
	- contain print name/id?
	- contain colors per piece name/id?
- examples:
	- https://zalgebar.com/print-coloring?print=openpillminiwcoverplate&mainchassis=#ff00ff
	- https://zalgebar.com/print-coloring?print=1001&1=#ff00ff&1=#ff00ff

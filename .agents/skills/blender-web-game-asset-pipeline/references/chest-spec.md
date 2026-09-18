# BubbleFortune Chest Specification

## Visual direction

Create a premium stylized game-show chest, not a plain storage box. Use a deep violet body, warm gold trim, controlled cyan/purple emissive accents, large readable proportions, and rounded hard-surface bevels. The design must remain legible when 26 instances are visible.

## Starting dimensions

Use these as initial dimensions and revise from approved reference views:

- width: `1.60 m`;
- depth: `0.82 m`;
- closed height: `1.05 m`;
- body height: approximately `0.68 m`;
- lid height: approximately `0.30 m`;
- trim projection: `0.025–0.05 m`;
- primary bevel: `0.025–0.045 m`.

## Required hierarchy

```text
BF_Chest_Root
├── BF_Chest_Base
│   ├── BF_Chest_Body
│   ├── BF_Chest_Trim
│   ├── BF_Chest_Corners
│   ├── BF_Chest_Latch
│   ├── BF_Chest_NumberPlate
│   └── BF_Chest_Interior
├── BF_Chest_LidPivot
│   └── BF_Chest_Lid
├── BF_UI_NumberAnchor
├── BF_UI_AmountAnchor
├── BF_FX_RewardAnchor
├── BF_FX_DustAnchor
└── BF_SFX_LatchAnchor
```

The lid pivot origin must sit on the rear hinge axis. The latch must be independently animatable. Number and amount values are runtime content and must not be baked into 26 unique meshes.

## Required materials

- `M_BF_Chest_Body`;
- `M_BF_Chest_GoldTrim`;
- `M_BF_Chest_Emissive`;
- optional `M_BF_Chest_Interior`.

Target one shared material set for all normal chests. Use material parameters or texture variants for player, opponent, rare, and theme states.

## Required clips

```text
Chest_Idle
Chest_Hover
Chest_Selected
Chest_Shake
Chest_Open
Chest_RewardHold
```

Suggested `Chest_Open` timing at 30 fps:

- frames 1–8: anticipation vibration;
- frames 9–14: latch releases;
- frames 15–32: lid rotates open with ease-out;
- frames 22–38: interior emissive ramps up;
- frames 33–45: settle and reward hold transition.

Keep particle bursts, screen shake, amount text, and camera moves outside the GLB in the Three.js runtime. The GLB should contain mechanical motion and optional emissive animation only.

## Runtime states

- normal: neutral trim and no glow;
- hover: cyan rim highlight, handled mainly at runtime;
- selected/player: gold emissive accent;
- locked: separate chain/lock accessory or runtime overlay;
- can-open: green/cyan pulse;
- opened: lid open, interior visible, amount anchor active;
- rare: alternate trim/accessory, same base hierarchy.

## Quality rejection examples

Reject the asset when:

- it is only nested cubes without designed trim or silhouette;
- the lid is a floating slab;
- the hinge is not functional;
- front frame pieces do not connect structurally;
- depth cannot be understood from side and rear views;
- number plate is modeled as a permanent number;
- animation requires rotating the whole chest;
- the model depends on a single camera angle to look correct.

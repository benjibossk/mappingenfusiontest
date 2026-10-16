# Vanilla WorldEditor generator prefabs

This file lists vanilla generator prefabs under `Prefabs/WEGenerators/` (paths only, resolved to GUIDs by the plugin). Total: 301 `.et`. `_base` = base prefab (parent, not meant for direct use). `_aut` = automatic/auto-generated variant of the sibling prefab.

Counts: root 3, Brushland 25, Bushline 10, Decals 21, Forest 114, Infrastructure 1, Miscellaneous 4, Pavements 8, Powerline 13, Roads 27, Stones 2, Walls 66, Water 7.

## Root (Prefabs/WEGenerators/)
- PG_StreamStones.et : stones along stream
- PG_Vegetatation_BirchTreeline.et : birch treeline (sic, typo in name)
- PG_Vegetation_CorylusBushline.et : hazel bushline

## Roads/
### Asphalt (RG_ = road generator)
- Roads/Asphalt/RG_Road_Asphalt_E_01.et : asphalt road, Everon style 1
- Roads/Asphalt/RG_Road_Asphalt_E_01_Narrow.et : asphalt road narrow
- Roads/Asphalt/RG_Road_Asphalt_E_01_DashedLine.et : asphalt road, dashed center line
- Roads/Asphalt/RG_Road_Asphalt_E_02.et : asphalt road style 2
- Roads/Asphalt/RG_Road_Asphalt_E_03.et : asphalt road style 3
### Cobblestone
- Roads/Cobblestone/RG_Road_Cobblestone_01.et : cobblestone road
- Roads/Cobblestone/RG_Road_Cobblestone_01_rough.et : cobblestone, rough
### Concrete
- Roads/Concrete/RG_Path_Concrete_USSR_base.et : BASE, USSR concrete path
- Roads/Concrete/RG_Path_Concrete_USSR_01.et : USSR concrete path
- Roads/Concrete/RG_Road_Concrete_USSR_base.et : BASE, USSR concrete road
- Roads/Concrete/RG_Road_Concrete_USSR_01_dashedline.et : USSR concrete road, dashed line
- Roads/Concrete/RG_Road_Concrete_USSR_01_narrow.et : USSR concrete road, narrow
- Roads/Concrete/RG_Road_Concrete_USSR_02.et : USSR concrete road style 2
- Roads/Concrete/RG_Road_ConcretePanel_01.et : concrete panel road
- Roads/Concrete/RG_Runway_10m.et : runway concrete 10 m wide
- Roads/Concrete/RG_Runway_20m.et : runway 20 m
- Roads/Concrete/RG_Runway_40m.et : runway 40 m
- Roads/Concrete/RG_Runway_60m.et : runway 60 m
### Dirt
- Roads/Dirt/RG_Road_Coal_01.et : coal road
- Roads/Dirt/RG_Road_Dirt_01.et : dirt road 1
- Roads/Dirt/RG_Road_Dirt_02.et : dirt road 2
- Roads/Dirt/RG_Road_Forest_01.et : forest road
- Roads/Dirt/RG_TrailCoal_01.et : coal trail (narrow)
- Roads/Dirt/RG_TrailDirt_01.et : dirt trail
- Roads/Dirt/RG_TrailForest_01.et : forest trail
- Roads/Dirt/RG_TrailGravel_01.et : gravel trail
### VergePosts
- Roads/VergePosts/PG_StoneVergePost_01.et : stone verge posts (prefab-line generator)

## Walls/ (walls, fences, barriers; WG_ = wall generator)
- Walls/WG_WallGenerator_base.et : BASE wall generator
### Brick
- Walls/Brick/WG_BrickWall_01.et : brick wall
- Walls/Brick/WG_BrickWall_02.et : brick wall 2
- Walls/Brick/WG_BrickWall_04_base.et : BASE brick wall 4
- Walls/Brick/WG_BrickWall_USSR_04.et : USSR brick wall
- Walls/Brick/WG_BrickWall_USSR_04_decorative.et : USSR brick wall, decorative
- Walls/Brick/WG_BrickWallOld_01.et : old brick wall
### Concrete
- Walls/Concrete/WG_ConcreteWall_01.et : concrete wall
- Walls/Concrete/WG_ConcreteWall_03_base.et : BASE concrete wall 3
- Walls/Concrete/WG_ConcreteWall_USSR_03.et : USSR concrete wall
### Crashbarrier
- Walls/Crashbarrier/WG_CrashBarrier_01A.et : guard rail A
- Walls/Crashbarrier/WG_CrashBarrier_01B.et : guard rail B
- Walls/Crashbarrier/WG_CrashBarrier_E_01.et : Everon guard rail
- Walls/Crashbarrier/WG_CrashBarrier_E_01_rusty.et : Everon guard rail, rusty
### Custom
- Walls/Custom/WG_WoodenConcretePoleFence_03.et : wooden fence on concrete poles
### Metal
- Walls/Metal/WG_MetalFence_01_base.et : BASE metal fence
- Walls/Metal/WG_MetalFence_USSR_01.et : USSR metal fence
- Walls/Metal/WG_MetalFenceDecorative_01_base.et : BASE decorative metal fence 1
- Walls/Metal/WG_MetalFenceDecorative_02_base.et : BASE decorative metal fence 2
- Walls/Metal/WG_MetalFenceDecorative_E_01.et : Everon decorative fence 1
- Walls/Metal/WG_MetalFenceDecorative_E_01_orange.et : same, orange
- Walls/Metal/WG_MetalFenceDecorative_E_01_turqoise.et : same, turquoise
- Walls/Metal/WG_MetalFenceDecorative_E_02.et : Everon decorative fence 2
- Walls/Metal/WG_MetalFenceDecorative_E_02_blue.et : same, blue
- Walls/Metal/WG_MetalFenceDecorative_E_02_white.et : same, white
- Walls/Metal/WG_MetalWall_01.et : metal wall
- Walls/Metal/WG_TinWall_01.et : tin sheet wall
- Walls/Metal/WG_TinWall_01_rusty.et : tin sheet wall, rusty
### Misc
- Walls/Misc/WG_CableTrestleMine_01_base.et : BASE mine cable trestle
- Walls/Misc/WG_CableTrestleMine_01.et : mine cable trestle
### Net
- Walls/Net/WG_GameProofFence_01.et : game-proof (wire) fence
- Walls/Net/WG_NetFence_01.et : wire net fence 1
- Walls/Net/WG_NetFence_01_Blue.et / _Brown.et / _Green.et : net fence 1 colour variants
- Walls/Net/WG_NetFence_02.et, _03.et, _04.et : net fence styles 2-4
- Walls/Net/WG_NetFence_05_base.et : BASE net fence 5
- Walls/Net/WG_NetFence_05_green.et / _white.et / _yellow.et : net fence 5 colours
- Walls/Net/WG_NetFence_05_short_base.et : BASE short net fence 5
- Walls/Net/WG_NetFence_05_short_green.et / _short_white.et / _short_yellow.et : short net fence 5 colours
- Walls/Net/WG_NetFence_USSR_01.et : USSR net fence
- Walls/Net/WG_NetFence_USSR_01_poles.et : USSR net fence, poles only
### Pipe
- Walls/Pipe/WG_PipeRailing_01.et, _02.et, _04.et : pipe railings
- Walls/Pipe/WG_PipeRailing_03_V1.et, _03_V2.et : pipe railing 3 variants
### Pole
- Walls/Pole/WG_PoleFence_01.et, WG_PoleFence_02.et : wooden pole fences
### Stone
- Walls/Stone/WG_StoneWall_01.et, WG_StoneWall_02.et : stone walls
### Wooden
- Walls/Wooden/WG_WoodenFence_01.et, _02.et, _03.et, _04.et : wooden fences
- Walls/Wooden/WG_WoodenFenceOld_01.et : old wooden fence
- Walls/Wooden/WG_WoodenRural_01.et : rural wooden fence
- Walls/Wooden/WG_WoodenWall_01.et : wooden wall
- Walls/Wooden/WG_WoodenWall_02.et, WG_WoodenWall_02_Green.et : wooden wall 2, green variant

## Pavements/
- Pavements/Asphalt/WG_Asphalt_Pavement_01_Narrow.et, _Wide.et : asphalt pavement (simple)
- Pavements/Asphalt/WG_AsphaltPavement_01_Narrow.et, _Wide.et : asphalt pavement (with kerb)
- Pavements/Concrete/WG_ConcreteKerb_01.et : concrete kerb
- Pavements/Concrete/WG_ConcreteKerb_USSR_01.et : USSR concrete kerb
- Pavements/Tile/WG_TilePavement_01_Narrow.et, _Wide.et : tile pavement

## Water/
- Water/Lake/LG_Lake_01.et : lake
- Water/Lake/LG_LakeDirty_01.et : dirty lake
- Water/Lake/LG_LakeMountain_01.et : mountain lake
- Water/Lake/LG_CainLake_01.et : Cain lake
- Water/Lake/LG_DirtyDrainage_01.et : dirty drainage pond
- Water/Pool/LG_Pool_01.et : swimming pool
- Water/River/R_RiverMedium_01.et : medium river

## Powerline/
- Powerline/Powerline_Base.et : BASE
- Powerline/Powerline.et : generic powerline
- Powerline/PG_PowerLine_01_nowire.et : no wire
- Powerline/PG_PowerLine_01_WoodenSmall.et : small wooden poles
- Powerline/PG_PowerLine_EHV_01.et : extra high voltage pylons
- Powerline/PG_Powerline_EHV_Half.et : EHV half
- Powerline/PG_PowerLine_HV_01_Concrete.et : HV concrete poles
- Powerline/PG_PowerLine_HV_02_Metal.et : HV metal pylons
- Powerline/PG_Powerline_HV_03_nowire.et : HV 3, no wire
- Powerline/PG_PowerLine_HV_03_Wooden.et : HV wooden poles
- Powerline/PG_PowerLine_HV_USSR_01.et : USSR HV
- Powerline/PG_PowerLine_LV_USSR_01.et : USSR low voltage
- Powerline/PG_LightningRod_01.et : lightning rods

## Infrastructure/ and Miscellaneous/ and Stones/
- Infrastructure/WG_DieselPipe_02.et : diesel pipeline
- Miscellaneous/PG_Antenna_Array_01_base.et : BASE antenna array
- Miscellaneous/PG_Antenna_Array_01_double.et, _single.et : antenna array variants
- Miscellaneous/WG_SubmarineCable_01.et : submarine cable
- Stones/FG_BeachStone_Dense.et, FG_BeachStones_Sparse.et : beach stones

## Decals/ (RG_ = road-style decal generators)
- Decals/Asphalt/RG_Asphalt_Patch_Stripe_01.et : asphalt patch stripe
- Decals/Beach/RG_Beach_NatureDebris_01_TEMP.et, _02_TEMP.et : beach debris (temp)
- Decals/Coal/RG_Coal_Tracks_01.et : coal tracks
- Decals/ConcretePanels/RG_ConcretePanelRow_01_A.et, _01_B.et : concrete panel rows
- Decals/Debris/RG_LeafDecal_Line_01.et, RG_LeafDecal_Line_01_aut.et : leaf line
- Decals/Dirt/RG_Dirt_Tracks_01.et : dirt tracks
- Decals/FlowerBed/RG_FlowerBed_01_TEMP.et : flower bed (temp)
- Decals/Nature/RG_SulfurStream_01_bank.et : sulfur stream bank
- Decals/Runway/RG_DrainChannel_02.et, RG_FuelChannel_01.et, RG_Runway_Line20_01.et, RG_Runway_Line50_01.et, RG_Runway_Line50_01_Yellow.et, RG_Runway_Line80_01.et, RG_RunwayBorder_01.et, RG_RunwayBorder_02.et, RG_SkidMarks_01.et, RG_SkidMarks_01_Light.et : runway markings, channels, skid marks

## Bushline/ (PG_ = prefab-line generators, Bushline/ prefix)
PG_Bushline_Betula_01, PG_Bushline_Corylus_01, PG_Bushline_Corylus_01_aut, PG_Bushline_Corylus_Small, PG_Bushline_Corylus_Small_aut, PG_Bushline_Phragmites_01, PG_Bushline_Sorbus_01, PG_Fucus_fesiculosus (seaweed), PG_Treeline_Birch_01, PG_Treeline_Birch_02 (all .et)

## Brushland/ (FG_ = forest generator, prefix Brushland/, all .et; each also has an `_aut` twin unless noted)
FG_Brushland_Dense, FG_Brushland_Pastures_01 (no aut), FG_Brushland_Phragmites, FG_Brushland_Picea_Dense, FG_Brushland_Picea_High, FG_Brushland_Picea_Mountain, FG_Brushland_Picea_Sparse, FG_Brushland_Salix, FG_Brushland_Sorbus_Dense, FG_Brushland_Sorbus_Sparse, FG_Brushland_Sparse, FG_Pioneer_Birch1, FG_Pioneer_Birch2

## Forest/ (114 files, prefix Forest/, all .et; `X` below means X.et and X_aut.et unless noted)
Base: FG_Forest_base (BASE).
Top level (no aut): FG_Brushland_Fireweed, FG_Brushline_Sorbus, FG_Forest_Birch2 (has aut too), FG_Forest_Clearing_Hornbeam, FG_Forest_Clearing, FG_Forest_Hornbeam, FG_Forest_Hornbeam2, FG_Forest_HornBeam3, FG_Stones_Mountain_1, FG_Brushland_SalixNanaWeathered_2, FG_Brushland_SalixNanaWeathered_3_2, FG_Brushland_SalixNanaWeathered_3_2_obsolete (obsolete), FG_Forest_PiceaWeathered_D_2_obsolete (obsolete).
Top level (X + X_aut): FG_Brushland_JuniperusPinusWeathered_1, _2; FG_Brushland_SalixNanaWeathered_1, _3_1; FG_Brushland_SalixPendulaWeathered_2; FG_Brushland_SorbusBetulaWeathered_1; FG_Forest_BetulaWeathered_1; FG_Forest_Birch; FG_Forest_Birch2; FG_Forest_Clearing (aut only extra); FG_Forest_Clearing_Pine; FG_Forest_Clearing_Spruce; FG_Forest_MixedBirchPine; FG_Forest_NurseryPicea; FG_Forest_NurseryPicea2s; FG_Forest_NurseryPine; FG_Forest_PiceaPendulaWeathered_2, _3; FG_Forest_PiceaWeathered_1, _2, _3, _D_1, _D_2; FG_Forest_Pine1, Pine1_2, Pine2, Pine2_2, Pine3; FG_Forest_PineSpruce1, PineSpruce2; FG_Forest_PineWeathered_1, _2, _S_1; FG_Forest_PinusWeathered_1; FG_Forest_Pioneer_BirchSpruce1; FG_Forest_Sorbus; FG_Forest_Spruce1, Spruce1_2, Spruce2, Spruce2_2, Spruce3; FG_Forest_WindFallenSpruces.
Forest/FG_Forest_Pinus/ (X + X_aut): FG_Forest_PinusWeathered_2, FG_Forest_PinusWeathered_Taper_1, FG_Forest_PinusWeathered_Young.
Forest/FG_Forest_Spruce_1/ (X + X_aut): FG_Brushland_Spruce_Mid_Cluster_1, FG_Forest_Spruce_1, FG_Forest_Spruce_Betula_Mix_50, FG_Forest_Spruce_Pine_Mix_50, FG_Forest_Spruce_Tall_Cluster_1, FG_Forest_Spruce_Taper_1.

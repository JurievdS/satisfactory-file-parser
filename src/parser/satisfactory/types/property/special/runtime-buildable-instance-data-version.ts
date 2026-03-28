
/**
 * Source: SaveCustomVersion.h
 */
export enum RuntimeBuildableInstanceDataVersion {
    NoVersion,

    InitialVersion,
    // 2025-03-18: Added data specific to the type of the lightweight buildable. Used for beams.
    AddedTypeSpecificData,
    // 2026-xx-xx: Added service provider and player info table index.
    AddedServiceProviderAndPlayerInfo,

    // -----<new versions can be added above this line>-------------------------------------------------
    VersionPlusOne,
    LatestVersion = VersionPlusOne - 1
}
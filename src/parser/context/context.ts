import { ChunkCompressionInfo } from "../satisfactory/save/save-body-chunks";

/**
 * Merged Context Type for Saves and Blueprints.
 */
export type ReaderWriterContext = SaveReaderWriterContext & BlueprintReaderWriterContext

/**
 * Context for reading/writing save files.
 * 
 * @param mods describes a list of mod names to their versions. Some mods have special needs.
 */
export type SaveReaderWriterContext = {
    throwErrors: boolean;
    saveHeaderType: number;
    saveVersion: number;
    buildVersion: number;
    mods: Record<string, string>;
    mapName?: string;
    compressionInfo?: ChunkCompressionInfo;
    persistentLevelUE5Version?: number;
    /** Set during object content parsing to the per-object UE5 version. Used by property parsers to determine format. */
    currentObjectUE5Version?: number;
}

/**
 * Context for reading/writing blueprint files.
 */
export type BlueprintReaderWriterContext = {
    throwErrors: boolean;
    headerVersion: number;
    saveVersion: number;
    buildVersion: number;
    blueprintConfigVersion: number;
}
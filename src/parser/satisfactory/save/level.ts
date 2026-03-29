
import { ContextReader } from '../../context/context-reader';
import { ContextWriter } from '../../context/context-writer';
import { CorruptSaveError, UnimplementedError } from '../../error/parser.error';
import { SaveComponent, isSaveComponent } from "../types/objects/SaveComponent";
import { SaveEntity, isSaveEntity } from "../types/objects/SaveEntity";
import { SaveObject } from "../types/objects/SaveObject";
import { ObjectReference } from "../types/structs/ObjectReference";
import { LevelToDestroyedActorsMap } from './level-to-destroyed-actors-map';
import { ObjectReferencesList } from './object-references-list';
import { SaveCustomVersion } from './save-custom-version';
import { SaveObjectVersionData } from './save-object-version-data';
import { SaveReader } from './save-reader';

/**
 * type for levels
 */
export type Level = {
	name: string;
	objects: (SaveEntity | SaveComponent)[];
	collectables: ObjectReference[];
	saveCustomVersion?: number;
	destroyedActorsMap?: LevelToDestroyedActorsMap;
	levelVersionData?: import('./save-object-version-data').SaveObjectVersionData;
}
export type Levels = { [levelName: string]: Level };

export namespace Level {

	export const ReadLevel = (reader: SaveReader, levelName: string): Level => {
		const level: Level = {
			name: levelName,
			objects: [],
			collectables: []
		}
		const isPersistentLevel = reader.context.mapName === levelName;

		// Section 1: object headers + collectables/destroyed actors
		let headersBinLen: number;
		if (reader.context.saveVersion >= SaveCustomVersion.UnrealEngine5) {
			headersBinLen = Number(reader.readInt64());
		} else {
			headersBinLen = reader.readInt32();
		}

		// object headers
		const posBeforeHeaders = reader.getBufferPosition();
		ReadAllObjectHeaders(reader, level.objects);

		// for persistent level, we have LevelToDestroyedActorsMap, else collectibles. Only listed here since U8.
		let remainingSize = headersBinLen - (reader.getBufferPosition() - posBeforeHeaders);
		if (remainingSize > 0) {

			if (isPersistentLevel) {
				level.destroyedActorsMap = LevelToDestroyedActorsMap.read(reader);
			} else {
				level.collectables = ObjectReferencesList.ReadList(reader);
			}

		} else {
			// its perfectly possible for ported saves to have nothing here.
		}


		remainingSize = headersBinLen - (reader.getBufferPosition() - posBeforeHeaders);
		if (remainingSize !== 0) {
			console.warn(`remaining size ${remainingSize} not 0 in level ${levelName}. Save may be corrupt.`);
		}

		// Section 2: object contents
		let objectContentsBinLen: number;
		if (reader.context.saveVersion >= SaveCustomVersion.UnrealEngine5) {
			objectContentsBinLen = Number(reader.readInt64());
		} else {
			objectContentsBinLen = reader.readInt32();
		}

		// objects contents
		const posBeforeContents = reader.getBufferPosition();
		ReadAllObjectContents(levelName, reader, level.objects, reader.onProgressCallback);
		level.objects = level.objects.filter(Boolean);
		const posAfterContents = reader.getBufferPosition();
		if (posAfterContents - posBeforeContents !== objectContentsBinLen) {
			console.warn(`save seems corrupt. Level ${level.name} is not even obeying the object count checksum.`, level.name);
		}

		// Section 3: level save version (non-persistent levels only)
		if (!isPersistentLevel) {
			level.saveCustomVersion = reader.readInt32();
		}

		// Section 4: collectables/destroyed actors (2nd occurrence)
		if (isPersistentLevel) {
			level.destroyedActorsMap = LevelToDestroyedActorsMap.read(reader);
		} else {
			level.collectables = ObjectReferencesList.ReadList(reader);
		}

		// Section 5: per-level SaveObjectVersionData (saveVersion >= 53, non-persistent only)
		if (!isPersistentLevel && reader.context.saveVersion >= SaveCustomVersion.SerializePerObjectVersionData) {
			const hasVersionData = reader.readInt32() >= 1;
			if (hasVersionData) {
				level.levelVersionData = SaveObjectVersionData.Parse(reader);
			}
		}

		return level;
	}

	export const SerializeLevel = (writer: ContextWriter, level: Level): void => {
		const isPersistentLevel = level.name === writer.context.mapName;
		const lenIndicatorHeaderAndDestroyedEntitiesSize = writer.getBufferPosition();

		if (writer.context.saveVersion >= SaveCustomVersion.UnrealEngine5) {
			writer.writeInt64(0n);	// len indicator (int64 placeholder)
		} else {
			writer.writeInt32(0);	// len indicator (int32 placeholder)
		}

		SerializeAllObjectHeaders(writer, level.objects);

		// <--- destroyed actors is the same as collectables list. Seems like its not there if count 0.
		if (isPersistentLevel && level.destroyedActorsMap !== undefined && Object.keys(level.destroyedActorsMap).length > 0) {
			LevelToDestroyedActorsMap.write(writer, level.destroyedActorsMap);
		} else if (!isPersistentLevel && level.collectables.length > 0) {
			ObjectReferencesList.SerializeList(writer, level.collectables);
		}

		// replace binary size from earlier for - object headers + collectables
		const sizeFieldBytes = writer.context.saveVersion >= SaveCustomVersion.UnrealEngine5 ? 8 : 4;
		writer.writeBinarySizeFromPosition(lenIndicatorHeaderAndDestroyedEntitiesSize, lenIndicatorHeaderAndDestroyedEntitiesSize + sizeFieldBytes);

		// write entities
		SerializeAllObjectContents(writer, level.objects, level.name);

		// level save version
		writer.writeInt32(level.saveCustomVersion ?? 0);

		// 2nd time.
		// for persistent level, we have LevelToDestroyedActorsMap, else collectibles
		if (isPersistentLevel) {
			LevelToDestroyedActorsMap.write(writer, level.destroyedActorsMap ?? {});
		} else {
			ObjectReferencesList.SerializeList(writer, level.collectables);
		}

		// per-level SaveObjectVersionData (saveVersion >= 53, non-persistent only)
		if (!isPersistentLevel && writer.context.saveVersion >= SaveCustomVersion.SerializePerObjectVersionData) {
			if (level.levelVersionData) {
				writer.writeInt32(1);
				SaveObjectVersionData.Serialize(writer, level.levelVersionData);
			} else {
				writer.writeInt32(0);
			}
		}
	}

	export const ReadAllObjectContents = (levelName: string, reader: ContextReader, objectsList: SaveObject[], onProgressCallback: (progress: number, msg?: string) => void): void => {
		const countEntities = reader.readInt32();
		if (countEntities !== objectsList.length) {
			throw new Error(`possibly corrupt. entity count ${countEntities} does not equal object count of ${objectsList.length}`);
		}

		// read in batches
		const batchSize = 10000;
		let readObjectsCount = 0;
		let lastProgressReport = 0;
		while (readObjectsCount < countEntities) {
			ReadNObjectContents(reader, Math.min(batchSize, countEntities - readObjectsCount), objectsList, readObjectsCount);
			readObjectsCount += Math.min(batchSize, countEntities - readObjectsCount);

			if (readObjectsCount - lastProgressReport > batchSize) {
				onProgressCallback(reader.getBufferProgress(), `read object count [${(readObjectsCount)}/${(countEntities)}] in level ${levelName}`);
				lastProgressReport = readObjectsCount;
			}
		}
	}

	export const ReadNObjectContents = (reader: ContextReader, count: number, objects: SaveObject[], objectListOffset: number = 0): void => {
		for (let i = 0; i < count; i++) {
			const obj = objects[i + objectListOffset];
			if (reader.context.saveVersion >= SaveCustomVersion.IntroducedWorldPartition) {
				obj.saveCustomVersion = reader.readInt32();
			}
			if (reader.context.saveVersion >= SaveCustomVersion.IntroducedWorldPartition) {
				obj.shouldMigrateObjectRefsToPersistent = reader.readInt32() >= 1;
			}

			const binarySize = reader.readInt32();
			const before = reader.getBufferPosition();

			// Per-object version data is stored AFTER the object body (at before + binarySize).
			// We read it first to get the UE5 version, which affects property parsing.
			let objectUE5Version = reader.context.persistentLevelUE5Version ?? -1;
			let trailingVersionDataSize = 0;
			if (obj.saveCustomVersion >= SaveCustomVersion.SerializePerObjectVersionData) {
				const jumpPos = before + binarySize;
				const savedPos = reader.getBufferPosition();
				reader.skipBytes(jumpPos - savedPos);

				const shouldSerialize = reader.readInt32() >= 1;
				if (shouldSerialize) {
					obj.perObjectVersionData = SaveObjectVersionData.Parse(reader);
					objectUE5Version = SaveObjectVersionData.GetUE5Version(obj.perObjectVersionData);
				}
				trailingVersionDataSize = reader.getBufferPosition() - jumpPos;

				// Seek back to read the actual object body
				reader.skipBytes(savedPos - reader.getBufferPosition());
			}

			// Set context for property parsers to check
			reader.context.currentObjectUE5Version = objectUE5Version;

			try {
				if (isSaveEntity(obj)) {
					SaveEntity.ParseData(obj as SaveEntity, binarySize, reader, obj.typePath, objectUE5Version);
				} else if (isSaveComponent(obj)) {
					SaveComponent.ParseData(obj as SaveComponent, binarySize, reader, obj.typePath, objectUE5Version);
				}

				const after = reader.getBufferPosition();
				if (after - before !== binarySize) {
					throw new CorruptSaveError(`Could not read entity ${obj.instanceName}, as ${after - before} bytes were read, but ${binarySize} bytes were indicated.`);
				}
			} catch (error) {
				if (reader.context.throwErrors) {
					throw error;
				} else {
					console.warn(`Could not read object ${obj.instanceName} of type ${obj.typePath} as a whole. will be removed from level's object list.`);
					reader.skipBytes(before - reader.getBufferPosition() + binarySize);
					objects[i + objectListOffset] = null as unknown as SaveObject;
				}
			}

			// Skip past the trailing version data
			if (trailingVersionDataSize > 0) {
				reader.skipBytes(trailingVersionDataSize);
			}
		}
	}

	export const SerializeAllObjectContents = (writer: ContextWriter, objects: (SaveEntity | SaveComponent)[], levelName: string): void => {
		const lenIndicatorEntities = writer.getBufferPosition();
		writer.writeInt32(0);

		if (writer.context.saveVersion >= SaveCustomVersion.UnrealEngine5) {
			writer.writeInt32Zero();
		}

		writer.writeInt32(objects.length);
		for (const obj of objects) {

			if (writer.context.saveVersion >= SaveCustomVersion.IntroducedWorldPartition) {
				writer.writeInt32(obj.saveCustomVersion);
			}
			if (writer.context.saveVersion >= SaveCustomVersion.IntroducedWorldPartition) {
				writer.writeInt32(obj.shouldMigrateObjectRefsToPersistent ? 1 : 0);
			}
			const lenReplacementPosition = writer.getBufferPosition();
			writer.writeInt32(0);

			if (isSaveEntity(obj)) {
				SaveEntity.SerializeData(writer, obj);
			} else if (isSaveComponent(obj)) {
				SaveComponent.SerializeData(writer, obj);
			}

			writer.writeBinarySizeFromPosition(lenReplacementPosition, lenReplacementPosition + 4);
		}
		writer.writeBinarySizeFromPosition(lenIndicatorEntities, lenIndicatorEntities + 8);
	}

	export const ReadAllObjectHeaders = (reader: ContextReader, objectsList: SaveObject[]): void => {
		let countObjectHeaders = reader.readInt32();
		if (countObjectHeaders > 1000000) {
			throw new CorruptSaveError(`Object header count ${countObjectHeaders} exceeds 1M safety limit. Likely corrupt data.`);
		}

		// read in batches
		const batchSize = 10000;
		let readObjectHeadersCount = 0;
		while (readObjectHeadersCount < countObjectHeaders) {
			objectsList.push(...ReadNObjectHeaders(reader, Math.min(batchSize, countObjectHeaders - readObjectHeadersCount)));
			readObjectHeadersCount += Math.min(batchSize, countObjectHeaders - readObjectHeadersCount);
		}
	}

	export const ReadNObjectHeaders = (reader: ContextReader, count: number): (SaveEntity | SaveComponent)[] => {
		let objects: (SaveEntity | SaveComponent)[] = [];
		let objectsRead = 0;
		for (; objectsRead < count; objectsRead++) {

			let obj: SaveEntity | SaveComponent;
			let objectType = reader.readInt32();
			switch (objectType) {
				case SaveEntity.TypeID:
					obj = new SaveEntity('', '', '', '');
					SaveEntity.ParseHeader(reader, obj);
					break;
				case SaveComponent.TypeID:
					obj = new SaveComponent('', '', '', '');
					SaveComponent.ParseHeader(reader, obj);
					break;
				default:
					throw new CorruptSaveError('Unknown object type' + objectType);
			}
			objects.push(obj);
		}
		return objects;
	}

	export const SerializeAllObjectHeaders = (writer: ContextWriter, objects: (SaveEntity | SaveComponent)[]): void => {
		writer.writeInt32(objects.length);
		for (const obj of objects) {

			switch (obj.type) {
				case 'SaveEntity':
					writer.writeInt32(SaveEntity.TypeID);
					SaveEntity.SerializeHeader(writer, obj);
					break;
				case 'SaveComponent':
					writer.writeInt32(SaveComponent.TypeID);
					SaveComponent.SerializeHeader(writer, obj);
					break;
				default:
					throw new UnimplementedError(`Unknown object type ${(obj as unknown as any).type}. Not implemented.`);
					break;
			}
		}
	}
}
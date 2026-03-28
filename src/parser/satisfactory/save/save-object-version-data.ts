import { ContextReader } from '../../context/context-reader';
import { ContextWriter } from '../../context/context-writer';

export type SaveObjectVersionData = {
	version: number;
	packageFileVersionUE4: number;
	packageFileVersionUE5: number;
	licenseeVersion: number;
	engineVersion: {
		major: number;
		minor: number;
		patch: number;
		changelist: number;
		branch: string;
	};
	customVersions: {
		guidA: bigint;
		guidB: bigint;
		version: number;
	}[];
};

export namespace SaveObjectVersionData {
	export const Parse = (reader: ContextReader): SaveObjectVersionData => {
		const version = reader.readUint32();
		const packageFileVersionUE4 = reader.readUint32();
		const packageFileVersionUE5 = reader.readUint32();
		const licenseeVersion = reader.readUint32();

		const major = reader.readUint16();
		const minor = reader.readUint16();
		const patch = reader.readUint16();
		const changelist = reader.readUint32();
		const branch = reader.readString();

		const customVersionCount = reader.readUint32();
		const customVersions: SaveObjectVersionData['customVersions'] = [];
		for (let i = 0; i < customVersionCount; i++) {
			const guidA = reader.readUint64();
			const guidB = reader.readUint64();
			const ver = reader.readUint32();
			customVersions.push({ guidA, guidB, version: ver });
		}

		return {
			version,
			packageFileVersionUE4,
			packageFileVersionUE5,
			licenseeVersion,
			engineVersion: { major, minor, patch, changelist, branch },
			customVersions
		};
	};

	export const Serialize = (writer: ContextWriter, data: SaveObjectVersionData): void => {
		writer.writeUint32(data.version);
		writer.writeUint32(data.packageFileVersionUE4);
		writer.writeUint32(data.packageFileVersionUE5);
		writer.writeUint32(data.licenseeVersion);

		writer.writeUint16(data.engineVersion.major);
		writer.writeUint16(data.engineVersion.minor);
		writer.writeUint16(data.engineVersion.patch);
		writer.writeUint32(data.engineVersion.changelist);
		writer.writeString(data.engineVersion.branch);

		writer.writeUint32(data.customVersions.length);
		for (const cv of data.customVersions) {
			writer.writeUint64(cv.guidA);
			writer.writeUint64(cv.guidB);
			writer.writeUint32(cv.version);
		}
	};

	export const GetUE5Version = (data: SaveObjectVersionData | undefined): number => {
		return data?.packageFileVersionUE5 ?? -1;
	};
}

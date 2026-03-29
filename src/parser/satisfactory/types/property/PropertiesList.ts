import { ContextReader } from '../../../context/context-reader';
import { ContextWriter } from '../../../context/context-writer';
import { ParserError } from '../../../error/parser.error';
import { AbstractBaseProperty, PropertiesMap } from './generic/AbstractBaseProperty';
import { ArrayProperty } from './generic/ArrayProperty/ArrayProperty';
import { BoolProperty } from './generic/BoolProperty';
import { ByteProperty } from './generic/ByteProperty';
import { DoubleProperty } from './generic/DoubleProperty';
import { EnumProperty } from './generic/EnumProperty';
import { FloatProperty } from './generic/FloatProperty';
import { Int32Property } from './generic/Int32Property';
import { Int64Property } from './generic/Int64Property';
import { Int8Property } from './generic/Int8Property';
import { MapProperty } from './generic/MapProperty';
import { ObjectProperty } from './generic/ObjectProperty';
import { SetProperty } from './generic/SetProperty/SetProperty';
import { SoftObjectProperty } from './generic/SoftObjectProperty';
import { StrProperty } from './generic/StrProperty';
import { StructProperty } from './generic/StructProperty';
import { TextProperty } from './generic/TextProperty';
import { Uint32Property } from './generic/Uint32Property';
import { Uint64Property } from './generic/Uint64Property';
import { Uint8Property } from './generic/Uint8Property';


export namespace PropertiesList {

	export const ParseList = (reader: ContextReader, objectUE5Version: number = -1): PropertiesMap => {

		const properties: PropertiesMap = {};
		let propertyName: string = reader.readString();
		while (propertyName !== 'None') {

			const parsedProperty = PropertiesList.ParseSingleProperty(reader, propertyName, objectUE5Version);

			// if it already exists, make it an array.
			if (properties[propertyName]) {
				if (!Array.isArray(properties[propertyName])) {
					properties[propertyName] = [properties[propertyName] as AbstractBaseProperty];
				}
				(properties[propertyName] as AbstractBaseProperty[]).push(parsedProperty);
			} else {
				properties[propertyName] = parsedProperty;
			}

			propertyName = reader.readString();
		}

		return properties;
	}

	export const SerializeList = (writer: ContextWriter, properties: PropertiesMap): void => {
		for (const property of Object.values(properties).flatMap(val => Array.isArray(val) ? val : [val])) {
			writer.writeString(property.name);
			PropertiesList.SerializeSingleProperty(writer, property);
		}
		writer.writeString('None');
	}

	/**
	 * Reads package name metadata used in the new property header format (UE5 >= 1012).
	 * Returns an array of package name strings (0-3 entries).
	 */
	const readPackageNames = (reader: ContextReader): string[] => {
		const names: string[] = [];
		const flag1 = reader.readUint32();
		if (flag1) {
			names.push(reader.readString());
			const flag23 = reader.readUint32();
			if (flag23) {
				names.push(reader.readString());
				names.push(reader.readString());
			}
		}
		return names;
	};

	export const ParseSingleProperty = (reader: ContextReader, propertyName: string, objectUE5Version: number = -1): AbstractBaseProperty => {
		let currentProperty: any = {};

		const propertyType = reader.readString();
		const useNewHeaderFormat = objectUE5Version >= 1012;

		// New property header format (UE5 >= 1012): type-specific metadata is front-loaded
		// into a discriminated header before the size field.
		let headerSubtype = '';
		let headerEnumName = '';
		let headerKeyType = '';
		let headerValueType = '';

		if (useNewHeaderFormat) {
			const headerTypeA = reader.readUint32();

			if (headerTypeA === 0) {
				// No additional header data (simple types)
			} else if (headerTypeA === 1) {
				if (propertyType === 'ArrayProperty') {
					headerSubtype = reader.readString(); // array element type
					const headerTypeB = reader.readUint32();
					if (headerTypeB === 1) {
						// struct array — store the sub-type for StructArrayProperty to use
						(reader.context as any)._structArraySubType = reader.readString();
						readPackageNames(reader);
					} else if (headerTypeB === 2) {
						// enum array
						reader.readString(); // enum name
						readPackageNames(reader);
						reader.readString(); // "ByteProperty"
						reader.readUint32(); // 0
					}
				} else if (propertyType === 'ByteProperty') {
					headerEnumName = reader.readString();
					readPackageNames(reader);
				} else if (propertyType === 'SetProperty') {
					headerSubtype = reader.readString();
					readPackageNames(reader);
				} else if (propertyType === 'StructProperty') {
					headerSubtype = reader.readString();
					readPackageNames(reader);
				}
			} else if (headerTypeA === 2) {
				if (propertyType === 'EnumProperty') {
					headerEnumName = reader.readString();
					readPackageNames(reader);
					reader.readString(); // "ByteProperty"
					reader.readUint32(); // 0
				} else if (propertyType === 'MapProperty') {
					headerKeyType = reader.readString();
					const hasKeyTypeName = reader.readUint32();
					if (hasKeyTypeName) {
						reader.readString(); // key type name (e.g. "IntVector")
						readPackageNames(reader);
					}
					headerValueType = reader.readString();
					const hasValueTypeName = reader.readUint32();
					if (hasValueTypeName) {
						reader.readString(); // value type name
						readPackageNames(reader);
					}
				}
			}
		}

		const binarySize = reader.readInt32();

		// Old format has propertyIndex after size; new format does not.
		const index = useNewHeaderFormat ? 0 : reader.readInt32();
		const before = reader.getBufferPosition();
		let overhead = 0;

		let subtype = '';

		try {
			switch (propertyType) {
				case 'BoolProperty':
					overhead = BoolProperty.CalcOverhead(currentProperty);
					currentProperty = BoolProperty.Parse(reader, propertyType, index);
					break;

				case 'ByteProperty': {
					const type = useNewHeaderFormat ? headerEnumName : reader.readString();
					overhead = useNewHeaderFormat ? 0 : ByteProperty.CalcOverhead(currentProperty, type);
					currentProperty = ByteProperty.Parse(reader, propertyType, index, type);
					break;
				}

				case 'Int8Property':
					overhead = Int8Property.CalcOverhead(currentProperty);
					currentProperty = Int8Property.Parse(reader, propertyType, index);
					break;

				case 'UInt8Property':
					overhead = Uint8Property.CalcOverhead(currentProperty);
					currentProperty = Uint8Property.Parse(reader, propertyType, index);
					break;

				case 'IntProperty':
				case 'Int32Property':
					overhead = Int32Property.CalcOverhead(currentProperty);
					currentProperty = Int32Property.Parse(reader, propertyType, index);
					break;

				case 'UInt32Property':
					overhead = Uint32Property.CalcOverhead(currentProperty);
					currentProperty = Uint32Property.Parse(reader, propertyType, index);
					break;

				case 'Int64Property':
					overhead = Int64Property.CalcOverhead(currentProperty);
					currentProperty = Int64Property.Parse(reader, propertyType, index);
					break;

				case 'UInt64Property':
					overhead = Uint64Property.CalcOverhead(currentProperty);
					currentProperty = Uint64Property.Parse(reader, propertyType, index);
					break;

				case 'SingleProperty':
				case 'FloatProperty':
					overhead = FloatProperty.CalcOverhead(currentProperty);
					currentProperty = FloatProperty.Parse(reader, propertyType, index);
					break;

				case 'DoubleProperty':
					overhead = DoubleProperty.CalcOverhead(currentProperty);
					currentProperty = DoubleProperty.Parse(reader, propertyType, index);
					break;

				case 'StrProperty':
				case 'NameProperty':
					overhead = StrProperty.CalcOverhead(currentProperty);
					currentProperty = StrProperty.Parse(reader, propertyType, index);
					break;

				case 'ObjectProperty':
				case 'InterfaceProperty':
					overhead = ObjectProperty.CalcOverhead(currentProperty);
					currentProperty = ObjectProperty.Parse(reader, propertyType, index);
					break;

				case 'SoftObjectProperty':
					overhead = SoftObjectProperty.CalcOverhead(currentProperty);
					currentProperty = SoftObjectProperty.Parse(reader, propertyType, index);
					break;

				case 'EnumProperty': {
					const name = useNewHeaderFormat ? headerEnumName : reader.readString();
					overhead = useNewHeaderFormat ? 0 : EnumProperty.CalcOverhead(currentProperty, name);
					currentProperty = EnumProperty.Parse(reader, propertyType, name, index);
					break;
				}

				case 'StructProperty':
					subtype = useNewHeaderFormat ? headerSubtype : reader.readString();
					overhead = useNewHeaderFormat ? 0 : StructProperty.CalcOverhead(currentProperty, subtype);
					currentProperty = StructProperty.Parse(reader, propertyType, index, binarySize, subtype);
					break;

				case 'ArrayProperty':
					subtype = useNewHeaderFormat ? headerSubtype : reader.readString();
					overhead = useNewHeaderFormat ? 0 : ArrayProperty.CalcOverhead(currentProperty, subtype);
					currentProperty = ArrayProperty.Parse(reader, propertyType, index, binarySize, subtype);
					break;

				case 'MapProperty': {
					const keyType = useNewHeaderFormat ? headerKeyType : reader.readString();
					const valueType = useNewHeaderFormat ? headerValueType : reader.readString();
					overhead = useNewHeaderFormat ? 0 : MapProperty.CalcOverhead(currentProperty, keyType, valueType);
					currentProperty = MapProperty.Parse(reader, propertyName, binarySize, keyType, valueType);
					break;
				}

				case 'TextProperty':
					overhead = TextProperty.CalcOverhead(currentProperty);
					currentProperty = TextProperty.Parse(reader, propertyType, index);
					break;

				case 'SetProperty':
					subtype = useNewHeaderFormat ? headerSubtype : reader.readString();
					overhead = useNewHeaderFormat ? 0 : SetProperty.CalcOverhead(currentProperty, subtype);
					currentProperty = SetProperty.Parse(reader, propertyType, index, propertyName, subtype);
					break;

				default:
					throw new Error(`Unimplemented type ${propertyType}, at byte position ${reader.getBufferPosition()}`);
			}

			currentProperty.name = propertyName;

			const readBytes = reader.getBufferPosition() - before - overhead;
			if (readBytes !== binarySize) {
				throw new ParserError('ParserError', `Property possibly corrupt. Read ${readBytes} bytes for ${propertyType} ${propertyName}, but ${binarySize} bytes were indicated.`);
			}
		} catch (error) {
			if (reader.context.throwErrors) {
				throw error;
			} else {

				// we inform about the error and skip the calculated byte content of the property.
				console.warn(`property ${propertyName} of type ${propertyType} could not be parsed. Skipping ${binarySize + overhead} bytes.`);

				reader.skipBytes(before - reader.getBufferPosition());
				const skipSize = binarySize + overhead;
				if (skipSize <= 65536) {
					(currentProperty as AbstractBaseProperty).rawBytes = Array.from(reader.readBytes(skipSize));
				} else {
					// Too large to store as array — just skip
					reader.skipBytes(skipSize);
				}
			}
		}

		return currentProperty;
	}

	export const SerializeSingleProperty = (writer: ContextWriter, property: AbstractBaseProperty): void => {

		// in case we have a property that we could not parse before.
		if (property.rawBytes !== undefined) {
			writer.writeBytesArray(property.rawBytes);
			return;
		}

		writer.writeString(property.ueType);

		// binary length indicator
		const lenIndicator = writer.getBufferPosition();
		writer.writeInt32(0);

		// write index if it is not 0. Since it normally is.
		writer.writeInt32(property.index ?? 0);

		const start = writer.getBufferPosition();
		let overhead = 0;
		switch (property.ueType) {
			case 'BoolProperty':
				overhead = BoolProperty.CalcOverhead(property as BoolProperty);
				BoolProperty.Serialize(writer, property as BoolProperty);
				break;

			case 'ByteProperty':
				overhead = ByteProperty.CalcOverhead(property as ByteProperty, (property as ByteProperty).value.type);
				ByteProperty.Serialize(writer, property as ByteProperty);
				break;

			case 'Int8Property':
				overhead = Int8Property.CalcOverhead(property as Int8Property);
				Int8Property.Serialize(writer, property as Int8Property);
				break;

			case 'UInt8Property':
				overhead = Uint8Property.CalcOverhead(property as Uint8Property);
				Uint8Property.Serialize(writer, property as Uint8Property);
				break;

			case 'IntProperty':
			case 'Int32Property':
				overhead = Int32Property.CalcOverhead(property as Int32Property);
				Int32Property.Serialize(writer, property as Int32Property);
				break;

			case 'UInt32Property':
				overhead = Uint32Property.CalcOverhead(property as Uint32Property);
				Uint32Property.Serialize(writer, property as Uint32Property);
				break;

			case 'Int64Property':
				overhead = Int64Property.CalcOverhead(property as Int64Property);
				Int64Property.Serialize(writer, property as Int64Property);
				break;

			case 'UInt64PRoperty':
				overhead = Uint64Property.CalcOverhead(property as Uint64Property);
				Uint64Property.Serialize(writer, property as Uint64Property);
				break;

			case 'SingleProperty':
			case 'FloatProperty':
				overhead = FloatProperty.CalcOverhead(property as FloatProperty);
				FloatProperty.Serialize(writer, property as FloatProperty);
				break;

			case 'DoubleProperty':
				overhead = DoubleProperty.CalcOverhead(property as DoubleProperty);
				DoubleProperty.Serialize(writer, property as DoubleProperty);
				break;

			case 'StrProperty':
			case 'NameProperty':
				overhead = StrProperty.CalcOverhead(property as StrProperty);
				StrProperty.Serialize(writer, property as StrProperty);
				break;

			case 'ObjectProperty':
			case 'InterfaceProperty':
				overhead = ObjectProperty.CalcOverhead(property as ObjectProperty);
				ObjectProperty.Serialize(writer, property as ObjectProperty);
				break;

			case 'SoftObjectProperty':
				overhead = SoftObjectProperty.CalcOverhead(property as SoftObjectProperty);
				SoftObjectProperty.Serialize(writer, property as SoftObjectProperty);
				break;

			case 'EnumProperty':
				overhead = EnumProperty.CalcOverhead(property as EnumProperty, (property as EnumProperty).value.name);
				EnumProperty.Serialize(writer, property as EnumProperty);
				break;

			case 'StructProperty':
				overhead = StructProperty.CalcOverhead(property as StructProperty, (property as StructProperty).subtype);
				StructProperty.Serialize(writer, property as StructProperty);
				break;

			case 'ArrayProperty':
				overhead = ArrayProperty.CalcOverhead(property as ArrayProperty.AvailableArrayPropertyTypes, (property as ArrayProperty.AvailableArrayPropertyTypes).subtype);
				ArrayProperty.Serialize(writer, property as ArrayProperty.AvailableArrayPropertyTypes);
				break;

			case 'MapProperty':
				overhead = MapProperty.CalcOverhead(property as MapProperty, (property as MapProperty).keyType, (property as MapProperty).valueType);
				MapProperty.Serialize(writer, property as MapProperty);
				break;

			case 'TextProperty':
				overhead = TextProperty.CalcOverhead(property as TextProperty);
				TextProperty.Serialize(writer, property as TextProperty);
				break;

			case 'SetProperty':
				overhead = SetProperty.CalcOverhead(property as SetProperty.AvailableSetPropertyTypes, (property as SetProperty.AvailableSetPropertyTypes).subtype);
				SetProperty.Serialize(writer, property as SetProperty.AvailableSetPropertyTypes);
				break;

			default:
				throw new Error(`Unimplemented type ${property.type}`);
		}

		// replace len indicator.
		writer.writeBinarySizeFromPosition(lenIndicator, start + overhead);
	}
}


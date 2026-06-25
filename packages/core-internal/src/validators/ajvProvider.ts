/**
 * AJV-based JSON Schema validator provider
 */

import type { Ajv } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import _addFormats from 'ajv-formats';

import { assertSchemaSafeToCompile } from './schemaBounds';
import { normalizeLegacyTupleSchema } from './schemaCompatibility';
import type { JsonSchemaType, JsonSchemaValidator, jsonSchemaValidator, JsonSchemaValidatorResult } from './types';

/** Structural subset of the AJV interface used by {@link AjvJsonSchemaValidator}. */
interface AjvLike {
    compile: (schema: unknown) => AjvValidateFunction;
    getSchema: (keyRef: string) => AjvValidateFunction | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    errorsText: (errors?: any) => string;
}

interface AjvValidateFunction {
    (input: unknown): boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    errors?: any;
}

function createDefaultAjvInstance(): Ajv {
    // SEP-2106: MCP tool schemas default to the JSON Schema 2020-12 dialect when no `$schema` is
    // declared. Plain `Ajv` is draft-07 and *silently ignores* 2020-12 keywords such as
    // `prefixItems` (e.g. it would accept `[1, "a"]` for a `[string, number]` tuple), which would
    // make validation disagree with the declared schema. `Ajv2020` runs the 2020-12 meta-schema and
    // vocabulary, matching the cfworker default (`draft: '2020-12'`) used in the browser/workerd
    // builds.
    const ajv = new Ajv2020({
        strict: false,
        validateFormats: true,
        validateSchema: false,
        allErrors: true
    });

    const addFormats = _addFormats as unknown as typeof _addFormats.default;
    addFormats(ajv);

    return ajv;
}

/**
 * AJV-backed JSON Schema validator. See `@modelcontextprotocol/{client,server}/validators/ajv`
 * for the customisation entry point (re-exports `Ajv2020`, `Ajv`, and `addFormats` from the bundled copy).
 *
 * @example Use with default configuration
 * ```ts source="./ajvProvider.examples.ts#AjvJsonSchemaValidator_default"
 * const validator = new AjvJsonSchemaValidator();
 * ```
 *
 * @example Use with a custom AJV instance
 * ```ts source="./ajvProvider.examples.ts#AjvJsonSchemaValidator_customInstance"
 * const ajv = new Ajv2020({ strict: true, allErrors: true });
 * const validator = new AjvJsonSchemaValidator(ajv);
 * ```
 *
 * @example Register ajv-formats
 * ```ts source="./ajvProvider.examples.ts#AjvJsonSchemaValidator_withFormats"
 * const ajv = new Ajv2020({ strict: true, allErrors: true });
 * addFormats(ajv);
 * const validator = new AjvJsonSchemaValidator(ajv);
 * ```
 */
export class AjvJsonSchemaValidator implements jsonSchemaValidator {
    private _ajv: AjvLike;
    private _normalizeLegacyTuples: boolean;

    /**
     * @param ajv - Optional pre-configured AJV-compatible instance. If omitted, a default instance is
     * created with `strict: false`, `validateFormats: true`, `validateSchema: false`, `allErrors: true`,
     * and `ajv-formats` registered. The parameter is typed structurally so consumers who don't pass
     * an instance need not have `ajv` installed.
     */
    constructor(ajv?: AjvLike) {
        this._ajv = ajv ?? createDefaultAjvInstance();
        this._normalizeLegacyTuples = ajv === undefined || ajv instanceof Ajv2020;
    }

    getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
        // SEP-2106: reject non-local $refs (SSRF) and over-budget schemas (composition DoS) before compiling.
        assertSchemaSafeToCompile(schema);
        const normalizedSchema = this._normalizeLegacyTuples ? normalizeLegacyTupleSchema(schema) : schema;

        const ajvValidator =
            '$id' in normalizedSchema && typeof normalizedSchema.$id === 'string'
                ? (this._ajv.getSchema(normalizedSchema.$id) ?? this._ajv.compile(normalizedSchema))
                : this._ajv.compile(normalizedSchema);

        return (input: unknown): JsonSchemaValidatorResult<T> => {
            const valid = ajvValidator(input);

            return valid
                ? {
                      valid: true,
                      data: input as T,
                      errorMessage: undefined
                  }
                : {
                      valid: false,
                      data: undefined,
                      errorMessage: this._ajv.errorsText(ajvValidator.errors)
                  };
        };
    }
}

export { Ajv } from 'ajv';
export { Ajv2020 } from 'ajv/dist/2020.js';
/** `ajv-formats` default export, normalised through the CJS/ESM interop wrapper. */
export const addFormats = _addFormats as unknown as typeof _addFormats.default;

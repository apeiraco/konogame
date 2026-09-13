import {
  LOCATION_BEHAVIOR_PORT,
  LocationCapability,
  LocationComparisonStatus,
  type LocationContext,
  type LocationContract,
  LocationError,
  LocationFeature,
  LocationOperation,
  type LocationOperation as LocationOperationType,
  type LocationPort,
  LocationPortId,
  LocationResolutionStatus,
  LocationValidationStatus,
  locationImplementation
} from "@konogame/infrastructure/contracts";
import { Context, Effect } from "effect";
import { type AdapterResolver } from "../adapter-resolution/service.ts";

export class LOCATION_BEHAVIOR extends Context.Service<
  LOCATION_BEHAVIOR,
  LocationBehaviorService
>()("infrastructure.location-behavior") {}

const locationOperations = {
  [LocationOperation.Validate]: {
    feature: LocationFeature.Validate,
    capability: LocationCapability.Validate
  },
  [LocationOperation.Compare]: {
    feature: LocationFeature.Compare,
    capability: LocationCapability.Compare
  },
  [LocationOperation.Resolve]: {
    feature: LocationFeature.Resolve,
    capability: LocationCapability.Resolve
  }
} as const satisfies Record<
  LocationOperationType,
  {
    feature: LocationFeature;
    capability: LocationCapability;
  }
>;

export class LocationBehaviorService implements LocationPort {
  constructor(private readonly adapterResolver: AdapterResolver) {}

  plan(operation: LocationOperationType, locations: readonly LocationContract[]) {
    return Effect.gen({ self: this }, function* () {
      return yield* this.adapterResolver.resolve([
        {
          feature: {
            id: locationOperations[operation].feature,
            port: LocationPortId,
            portVersion: LOCATION_BEHAVIOR_PORT.version,
            operation,
            requiredCapabilities: [locationOperations[operation].capability]
          },
          locations
        }
      ]);
    }).pipe(
      Effect.mapError((cause) => new LocationError({ operation, cause, message: cause.message }))
    );
  }

  private resolvedPort(operation: LocationOperationType, locations: readonly LocationContract[]) {
    return Effect.gen({ self: this }, function* () {
      const plan = yield* this.plan(operation, locations);
      const resolvedAdapter = plan.resolvedAdapters[0];
      return {
        plan,
        port: resolvedAdapter
          ? this.adapterResolver.implementation(resolvedAdapter, locationImplementation)
          : undefined
      };
    });
  }

  validate(input: Parameters<NonNullable<LocationPort["validate"]>>[0]) {
    return Effect.gen({ self: this }, function* () {
      const { plan, port } = yield* this.resolvedPort(LocationOperation.Validate, [input.location]);
      return port?.validate
        ? yield* port.validate(input)
        : {
            status: LocationValidationStatus.Unverified,
            reason: plan.unavailable[0]?.reason ?? "Location validation is unavailable"
          };
    });
  }

  compare(input: Parameters<NonNullable<LocationPort["compare"]>>[0]) {
    return Effect.gen({ self: this }, function* () {
      const [left, right] = yield* Effect.all([
        this.validate({ location: input.left, context: input.context }),
        this.validate({ location: input.right, context: input.context })
      ]);
      if (
        left.status !== LocationValidationStatus.Valid ||
        right.status !== LocationValidationStatus.Valid
      ) {
        return {
          status: LocationComparisonStatus.Unknown,
          reason: left.reason ?? right.reason ?? "Location has not been validated"
        };
      }
      const { plan, port } = yield* this.resolvedPort(LocationOperation.Compare, [
        input.left,
        input.right
      ]);
      return port?.compare
        ? yield* port.compare(input)
        : {
            status: LocationComparisonStatus.Incomparable,
            reason: plan.unavailable[0]?.reason ?? "No compatible Location comparison Adapter"
          };
    });
  }

  resolve(input: Parameters<NonNullable<LocationPort["resolve"]>>[0]) {
    return Effect.gen({ self: this }, function* () {
      const validation = yield* this.validate(input);
      if (validation.status !== LocationValidationStatus.Valid) {
        return {
          status: LocationResolutionStatus.Unavailable,
          reason: validation.reason ?? "Location has not been validated"
        };
      }
      const { plan, port } = yield* this.resolvedPort(LocationOperation.Resolve, [input.location]);
      return port?.resolve
        ? yield* port.resolve(input)
        : {
            status: LocationResolutionStatus.Unavailable,
            reason: plan.unavailable[0]?.reason ?? "Location resolution is unavailable"
          };
    });
  }

  inspect(location: LocationContract, context?: LocationContext) {
    return Effect.gen({ self: this }, function* () {
      const validation = yield* this.validate({ location, context });
      const resolution = yield* this.resolve({ location, context });
      const validationPlan = yield* this.plan(LocationOperation.Validate, [location]);
      const resolutionPlan = yield* this.plan(LocationOperation.Resolve, [location]);
      return {
        validation,
        availability: resolution,
        adapterResolutionPlan: {
          declarationProtocolVersion: validationPlan.declarationProtocolVersion,
          resolvedAdapters: [
            ...validationPlan.resolvedAdapters,
            ...resolutionPlan.resolvedAdapters
          ],
          unavailable: [...validationPlan.unavailable, ...resolutionPlan.unavailable]
        }
      };
    });
  }
}

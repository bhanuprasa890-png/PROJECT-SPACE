/**
 * Prediction layer — public entry point.
 *
 *   Input Data → Prediction Engine → Occupancy Prediction → Crowd Classification
 *                                                          → Route Optimization
 */

export {
  PredictionEngine,
  createPredictor,
  describeEngine,
  SIMULATION_DISCLAIMER,
  PREDICTION_STAGES,
  PREDICTION_INPUTS,
  type PredictionEngineOptions,
  type PredictionRequest,
} from './engine';
export { CROWD_CLASSES, CLASSIFICATION_EXAMPLES, classifyOccupancyPercentage, toCrowdClass } from './classification';
export {
  WEATHER_FACTORS,
  WEATHER_CONDITIONS,
  isWeatherCondition,
  currentWeather,
  listWeatherSlots,
  nearestWeather,
  synthesiseWeather,
  type WeatherSlot,
  type WeatherProvider,
} from './weather';
export { SignalIndex, priorRatio, buildPredictionInput, type BuildInputArgs } from './signals';
export { HeuristicEnsemblePredictor, heuristicPredictor } from './predictors/heuristic-ensemble';
export { ExternalModelPredictor } from './predictors/external-model';
export type {
  OccupancyPredictor,
  PredictionCore,
  PredictionInput,
  PredictorKind,
  WeatherCondition,
  WeatherSignal,
  HistoricalSignal,
  LiveSignal,
  RouteSignal,
  FactorContribution,
} from './types';

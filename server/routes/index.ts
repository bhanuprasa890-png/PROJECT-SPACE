import { Router } from 'express';
import { healthRouter } from './health.routes';
import { networkRouter } from './network.routes';
import { plannerRouter } from './planner.routes';
import { crowdRouter } from './crowd.routes';
import { alertsRouter } from './alerts.routes';
import { operatorRouter } from './operator.routes';
import { riderRouter } from './rider.routes';
import { predictionRouter } from './prediction.routes';
import { datasetRouter } from './dataset.routes';

/**
 * API surface (all paths are mounted under `/api`).
 *
 *   health   GET    /health                      stack + database report
 *   network  GET    /network | /stops | /lines   reference data
 *   planner  GET    /plan | POST /plan           journey recommendations
 *   planner  GET    /journey-context             route-details payload
 *   crowd    GET    /crowd/live | forecast | history
 *   predict  GET    /prediction | /prediction/series | /prediction/engine
 *            GET    /prediction/weather | /prediction/routes
 *   alerts   GET    /alerts · POST /alerts · PATCH /alerts/:id
 *   operator GET    /operator/overview | fleet | line-load | demand | config
 *   rider    GET    /dashboard | /profile | /settings/options | /watchlist
 *   dataset  GET    /dataset/tables | /dataset/tables/:table | /dataset/schema/:table
 *            POST   /dataset/refresh            rebuild canonical demo dataset
 */
export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(networkRouter);
apiRouter.use(plannerRouter);
apiRouter.use(crowdRouter);
apiRouter.use(predictionRouter);
apiRouter.use(alertsRouter);
apiRouter.use(operatorRouter);
apiRouter.use(riderRouter);
apiRouter.use(datasetRouter);

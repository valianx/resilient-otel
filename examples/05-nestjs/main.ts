/**
 * NestJS bootstrap. enableShutdownHooks() lets the observability lifecycle
 * flush telemetry on SIGTERM before the process exits.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(3000);
}

void bootstrap();

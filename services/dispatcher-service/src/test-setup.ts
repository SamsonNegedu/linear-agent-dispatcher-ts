import { Logger } from '@nestjs/common';
import { TestingLogger } from '@nestjs/testing/services/testing-logger.service';

// Keep expected-failure logs out of test output. Nest's TestingLogger still prints errors.
Logger.overrideLogger(false);
TestingLogger.prototype.error = () => undefined;

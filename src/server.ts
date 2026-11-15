import { startExportCleanup } from './transfer/transfer.server';
import { createServerEntry, createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server';
import { FastResponse } from 'srvx';
import { startPictureCleanup } from './vehicles/picture-storage.server';

globalThis.Response = FastResponse;
startPictureCleanup();
startExportCleanup();

export default createServerEntry({
    fetch: createStartHandler(defaultStreamHandler)
});

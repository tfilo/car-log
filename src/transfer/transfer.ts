import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { HttpMethod, HttpStatus } from '../common/http';
import { transferStatus, beginExport, receiveImport, downloadExport, executeTransferOperation } from './transfer.server';

export const getTransferStatus = createServerFn({ method: HttpMethod.GET }).handler(() => executeTransferOperation(transferStatus));
export const startExport = createServerFn({ method: HttpMethod.POST }).handler(() => executeTransferOperation(beginExport));
export const importArchive = createServerFn({ method: HttpMethod.POST })
    .validator((data: { base64: string }) =>
        z
            .strictObject({
                base64: z
                    .string()
                    .max(140000000, { abort: true })
                    .regex(/^[A-Za-z0-9+/]*={0,2}$/)
            })
            .parse(data)
    )
    .handler(({ data }) => executeTransferOperation(() => receiveImport(data.base64)));
export const getExportDownload = createServerFn({ method: HttpMethod.GET }).handler(() =>
    downloadExport().catch(() => new Response(null, { status: HttpStatus.SERVICE_UNAVAILABLE }))
);

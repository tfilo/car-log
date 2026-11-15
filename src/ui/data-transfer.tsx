import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useTranslation } from 'react-i18next';
import { Button, Section } from '@tfilo/tope-ui';
import { getTransferStatus, startExport, importArchive, getExportDownload } from '../transfer/transfer';
import { ExportState, TransferError } from '../transfer/transfer-values';

export function DataTransferSection({ userId }: { userId: string }) {
    const { t } = useTranslation('auth');
    const status = useServerFn(getTransferStatus);
    const exportData = useServerFn(startExport);
    const importData = useServerFn(importArchive);
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState(false);
    const [importing, setImporting] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState(false);
    const query = useQuery({
        queryKey: ['dataTransfer', userId],
        staleTime: 0,
        queryFn: () => status(),
        refetchInterval: (query) =>
            query.state.data && 'state' in query.state.data && query.state.data.state === ExportState.RUNNING ? 1000 : false
    });
    const data = query.data && 'state' in query.data ? query.data : null;

    async function runExport() {
        setBusy(true);
        setError(false);
        try {
            const result = await exportData();
            if ('error' in result) setError(true);
            await query.refetch();
        } catch {
            setError(true);
        } finally {
            setBusy(false);
        }
    }

    async function runImport() {
        if (!file) return;
        setImporting(true);
        setError(false);
        try {
            if (file.size > 100 * 1024 * 1024) {
                setError(true);
                return;
            }
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(',')[1]);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });
            const result = await importData({ data: { base64 } });
            if ('error' in result) setError(true);
            await queryClient.invalidateQueries();
        } catch {
            setError(true);
        } finally {
            setImporting(false);
        }
    }

    return (
        <>
            <Section title={t('transfer.exportHeading')}>
                <p>{t('transfer.exportHelp')}</p>
                <Button
                    disabled={!data || busy || data.state === ExportState.RUNNING}
                    onClick={() => void runExport()}
                >
                    {t('transfer.export')}
                </Button>
                {(busy || data?.state === ExportState.RUNNING) && <p role='status'>{t('transfer.exportRunning')}</p>}
                {data?.state === ExportState.FAILED && <p role='alert'>{t('transfer.exportFailed')}</p>}
                {data?.downloadable && (
                    <p>
                        <a
                            href={getExportDownload.url}
                            download='car-log.zip'
                        >
                            {t('transfer.download')}
                        </a>
                    </p>
                )}
            </Section>
            <Section title={t('transfer.importHeading')}>
                <p>{t('transfer.importHelp')}</p>
                <input
                    type='file'
                    accept='.zip,application/zip'
                    aria-label={t('transfer.file')}
                    disabled={!data?.canImport || importing}
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <Button
                    disabled={!data?.canImport || !file || importing}
                    onClick={() => void runImport()}
                >
                    {t('transfer.import')}
                </Button>
                {data && !data.canImport && <p>{t('transfer.notEmpty')}</p>}
                {importing && <p role='status'>{t('transfer.importRunning')}</p>}
                {data?.importedAt && (
                    <p role='status'>{t('transfer.imported', { date: new Date(data.importedAt).toLocaleString('sk-SK') })}</p>
                )}
                {data?.importError && (
                    <p role='alert'>{t(`transfer.${data.importError === TransferError.NOT_EMPTY ? 'notEmpty' : 'invalid'}`)}</p>
                )}
                {(error || query.isError) && <p role='alert'>{t('transfer.unavailable')}</p>}
            </Section>
        </>
    );
}

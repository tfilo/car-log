/* eslint-disable react-refresh/only-export-components */
import { statisticsKeys } from '../../../statistics/statistics-queries';
import { useCallback, useState } from 'react';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useTranslation } from 'react-i18next';
import { Button, Page, Table, createColumns } from '@tfilo/tope-ui';
import { ArchiveBoxIcon, ArrowUturnLeftIcon, TrashIcon } from '@heroicons/react/16/solid';
import { updateExpenseCategory } from '../../../expenses/expenses';
import { expenseCategoryPageOptions, expenseKeys } from '../../../expenses/expense-queries';
import type { CategoryData } from '../../../expenses/expense.types';
import { AuthErrorCode } from '../../../auth/auth-errors';
import { replaceCurrentUser } from '../../../ui/session';
import { expenseErrors } from '../../../ui/expense-feedback';
import { getExpenseErrorKey } from '../../../expenses/expense-errors';
import { ErrorMessages } from '../../../ui/feedback';
import { MobileTableRow, TableRowMenu } from '../../../ui/mobile-table-row';
import { CategoryEditor } from '../../../ui/category-editor';
import { DeleteCategoryDialog } from '../../../ui/delete-category-dialog';

export const Route = createFileRoute('/_authenticated/expenses/categories')({
    loader: ({ context }) => context.queryClient.query({ ...expenseCategoryPageOptions(0, 25), staleTime: 0 }),
    component: CategoriesPage
});

function CategoriesPage() {
    const { t } = useTranslation('expenses');
    const router = useRouter();
    const queryClient = useQueryClient();
    const update = useServerFn(updateExpenseCategory);

    const [errors, setErrors] = useState<string[]>([]);
    const [revision, setRevision] = useState(0);
    const [total, setTotal] = useState<number | null>(null);
    const [editor, setEditor] = useState<{ category?: CategoryData } | null>(null);
    const [selected, setSelected] = useState<CategoryData | null>(null);
    const [busy, setBusy] = useState(false);

    const onFetch = useCallback(
        async (page: number, pageSize: number) => {
            const result = await queryClient.query(expenseCategoryPageOptions(page, pageSize));

            setTotal(result.total);

            return { data: result.categories, page: result.page, pageSize: result.pageSize, totalRecords: result.total };
        },
        [queryClient]
    );

    async function toggleArchive(category: CategoryData) {
        if (busy) return;

        setBusy(true);
        setErrors([]);

        try {
            const result = await update({ data: { categoryId: category.id, name: category.name, isArchived: !category.isArchived } });

            if ('code' in result) {
                setErrors(expenseErrors(result));
                if (result.code === AuthErrorCode.AUTH_REQUIRED) await replaceCurrentUser(queryClient, null);

                return;
            }

            await queryClient.invalidateQueries({ queryKey: expenseKeys.all });
            await queryClient.invalidateQueries({ queryKey: statisticsKeys.all });
            setRevision((value) => value + 1);
        } catch (error) {
            setErrors([getExpenseErrorKey(error instanceof Error ? error.message : undefined)]);
        } finally {
            setBusy(false);
        }
    }

    const columns = createColumns<CategoryData>([
        { header: t('categories.name'), accessor: 'name' },
        {
            header: t('categories.status'),
            accessor: 'isArchived',
            formatter: (archived) => t(archived ? 'categories.archived' : 'categories.active')
        },
        { header: t('categories.expenseCount'), accessor: 'expenseCount' },
        {
            header: t('categories.serviceIntervalKm'),
            accessor: 'serviceIntervalKm',
            formatter: (value) => (value === undefined ? '—' : String(value))
        },
        {
            header: t('categories.serviceIntervalMonths'),
            accessor: 'serviceIntervalMonths',
            formatter: (value) => (value === undefined ? '—' : String(value))
        },
        {
            header: t('actions'),
            accessor: 'id',
            additionalClassName: 'w-none whitespace-nowrap border-l text-right sticky right-none bg-white shadow-lg shadow-secondary-light',
            cell: (category) => (
                <div className='ml-auto flex w-max justify-end gap-sm'>
                    <Button
                        icon={category.isArchived ? ArrowUturnLeftIcon : ArchiveBoxIcon}
                        showChildren={false}
                        variant='transparent'
                        disabled={busy}
                        onClick={() => toggleArchive(category)}
                    >
                        {t(category.isArchived ? 'categories.restore' : 'categories.archive')}
                    </Button>
                    <Button
                        icon={TrashIcon}
                        showChildren={false}
                        variant='danger'
                        aria-label={t('categories.delete')}
                        disabled={busy || category.expenseCount > 0}
                        title={category.expenseCount ? t('categories.deleteInUse') : t('categories.delete')}
                        onClick={() => setSelected(category)}
                    >
                        {t('categories.delete')}
                    </Button>
                </div>
            )
        }
    ]);

    return (
        <Page
            title={t('categories.heading')}
            onBack={() => router.navigate({ to: '/expenses', search: {} })}
        >
            <p className='text-sm'>{t('categories.help')}</p>
            <Button onClick={() => setEditor({})}>{t('categories.add')}</Button>
            {total === 0 && <p role='status'>{t('categories.empty')}</p>}
            <ErrorMessages
                errors={errors}
                namespace='expenses'
            />
            <Table
                key={revision}
                columns={columns}
                onFetch={onFetch}
                pageSize={25}
                onRowClick={(category) => {
                    if (!busy) setEditor({ category });
                }}
                renderMobileRow={(category) => (
                    <MobileTableRow
                        title={category.name}
                        value={t(category.isArchived ? 'categories.archived' : 'categories.active')}
                        actions={
                            <TableRowMenu
                                label={t('actions')}
                                options={[
                                    {
                                        label: t(category.isArchived ? 'categories.restore' : 'categories.archive'),
                                        icon: category.isArchived ? ArrowUturnLeftIcon : ArchiveBoxIcon,
                                        disabled: busy,
                                        onClick: () => toggleArchive(category)
                                    },
                                    {
                                        label: t('categories.delete'),
                                        icon: TrashIcon,
                                        disabled: busy || category.expenseCount > 0,
                                        onClick: () => setSelected(category)
                                    }
                                ]}
                            />
                        }
                    >
                        <p>
                            {t('categories.expenseCount')}: {category.expenseCount}
                        </p>
                        {category.serviceIntervalKm !== undefined && (
                            <p>
                                {t('categories.serviceIntervalKm')}: {category.serviceIntervalKm}
                            </p>
                        )}
                        {category.serviceIntervalMonths !== undefined && (
                            <p>
                                {t('categories.serviceIntervalMonths')}: {category.serviceIntervalMonths}
                            </p>
                        )}
                        {category.expenseCount > 0 && <p className='text-secondary'>{t('categories.deleteInUse')}</p>}
                    </MobileTableRow>
                )}
            />
            {editor && (
                <CategoryEditor
                    category={editor.category}
                    onClose={() => setEditor(null)}
                    onSaved={() => {
                        setEditor(null);
                        setRevision((value) => value + 1);
                    }}
                />
            )}
            {selected && (
                <DeleteCategoryDialog
                    category={selected}
                    onClose={() => setSelected(null)}
                    onDeleted={() => {
                        setSelected(null);
                        setRevision((value) => value + 1);
                    }}
                />
            )}
        </Page>
    );
}

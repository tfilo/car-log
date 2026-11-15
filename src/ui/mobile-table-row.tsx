import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { Dropdown } from '@tfilo/tope-ui';

export function MobileTableRow({
    title,
    value,
    actions,
    children
}: PropsWithChildren<{ title: ReactNode; value?: ReactNode; actions?: ReactNode }>) {
    return (
        <div className='flex items-start justify-between gap-md'>
            <div className='min-w-none flex-1 wrap-anywhere'>
                <div className='flex flex-wrap justify-between gap-md font-bold'>
                    <span>{title}</span>
                    {value !== undefined && <span className='whitespace-nowrap'>{value}</span>}
                </div>
                <div className='mt-sm flex flex-col gap-sm *:text-sm'>{children}</div>
            </div>
            {actions && <div className='shrink-0'>{actions}</div>}
        </div>
    );
}

export function TableRowMenu({ label, options }: { label: string; options: ComponentProps<typeof Dropdown>['options'] }) {
    return (
        <Dropdown
            showChevron={false}
            buttonProps={{ variant: 'transparent', 'aria-label': label, additionalClassName: 'min-w-[44px] min-h-[44px]' }}
            options={options}
        >
            ⋮
        </Dropdown>
    );
}

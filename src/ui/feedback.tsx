import { useTranslation } from 'react-i18next';

export function ErrorMessages({
    errors,
    namespace = 'auth'
}: {
    errors: readonly string[];
    namespace?: 'auth' | 'vehicles' | 'fuel' | 'expenses' | 'statistics';
}) {
    const { t } = useTranslation(namespace);

    if (!errors.length) return null;

    return (
        <div role='alert'>
            {errors.map((key) => (
                <p
                    key={key}
                    className='text-danger'
                >
                    {t(key)}
                </p>
            ))}
        </div>
    );
}

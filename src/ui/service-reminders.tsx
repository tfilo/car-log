import { Button } from '@tfilo/tope-ui';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ServiceStatus, type ServiceSchedule } from '../service/service-schedule';
import { displayNumber } from '../common/number';
import { displayStatisticsDay } from '../statistics/statistics-format';
import { displayFuelTime } from '../fuel/fuel-time';

export function ServiceReminders({
    schedules,
    vehicleId,
    vehicleName,
    mileageAt
}: {
    schedules: ServiceSchedule[];
    vehicleId: string;
    vehicleName: string;
    mileageAt: string | null;
}) {
    const { t } = useTranslation('expenses');
    const router = useRouter();

    return schedules
        .filter((schedule) => schedule.status !== ServiceStatus.UPCOMING)
        .map((schedule) => (
            <div
                key={schedule.categoryId}
                role='status'
                className={`flex flex-col gap-md rounded-sm border p-lg ${schedule.status === ServiceStatus.DUE ? 'border-danger bg-danger-light/20' : schedule.status === ServiceStatus.WARNING ? 'border-warning bg-warning-light/20' : 'border-default bg-secondary-extra-light/30'}`}
            >
                <p className={schedule.status === ServiceStatus.DUE ? 'font-bold text-danger' : 'font-bold'}>
                    {vehicleName} · {schedule.name}: {t(`service.status.${schedule.status}`)}
                </p>
                {schedule.lastOccurredAt && (
                    <p className='text-sm'>
                        {t('service.lastService', {
                            date: displayFuelTime(schedule.lastOccurredAt),
                            mileage: displayNumber(schedule.lastOdometer!, 0, 3)
                        })}
                    </p>
                )}
                {schedule.dueOdometer !== null && (
                    <p className='text-sm'>
                        {t('service.nextMileage', { mileage: displayNumber(schedule.dueOdometer, 0, 3) })} ·{' '}
                        {schedule.remainingKm === null
                            ? t('service.mileageUnknown')
                            : t(schedule.remainingKm < 0 ? 'service.overdueKm' : 'service.remainingKm', {
                                  distance: displayNumber(Math.abs(schedule.remainingKm), 0, 3)
                              })}
                    </p>
                )}
                {schedule.dueDay && (
                    <p className='text-sm'>
                        {t('service.nextDate', { date: displayStatisticsDay(schedule.dueDay) })} ·{' '}
                        {t(schedule.remainingDays! < 0 ? 'service.overdueDays' : 'service.remainingDays', {
                            days: Math.abs(schedule.remainingDays!)
                        })}
                    </p>
                )}
                {mileageAt && schedule.dueOdometer !== null && (
                    <p className='text-sm text-secondary'>{t('service.mileageObserved', { date: displayFuelTime(mileageAt) })}</p>
                )}
                <Button
                    variant='outline'
                    onClick={() => router.navigate({ to: '/expenses/new', search: { vehicleId, categoryId: schedule.categoryId } })}
                >
                    {t('service.record')}
                </Button>
            </div>
        ));
}

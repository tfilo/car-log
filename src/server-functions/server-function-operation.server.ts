import { getTransferStatus, startExport, importArchive, getExportDownload } from '../transfer/transfer';
import { getStatistics } from '../statistics/statistics';
import {
    listExpenses,
    getExpense,
    createExpense,
    updateExpense,
    deleteExpense,
    listExpenseCategories,
    createExpenseCategory,
    updateExpenseCategory,
    deleteExpenseCategory
} from '../expenses/expenses';
import { listFuelRecords, getFuelRecord, createFuelRecord, updateFuelRecord, deleteFuelRecord } from '../fuel/fuel';
import { listVehicles, getVehicle, createVehicle, updateVehicle, deleteVehicle } from '../vehicles/vehicles';
import { ServerFunctionOperation } from './server-function-operations';
import {
    register,
    getRegistrationAvailability,
    login,
    getCurrentUser,
    logout,
    updateMyProfile,
    confirmEmail,
    requestEmailVerification,
    requestPasswordReset,
    resetPassword
} from '../auth/auth';
import { listUsers, manageUser, deleteMyAccount } from '../users/users';

const functions = {
    [ServerFunctionOperation.GET_TRANSFER_STATUS]: getTransferStatus,
    [ServerFunctionOperation.START_EXPORT]: startExport,
    [ServerFunctionOperation.IMPORT_ARCHIVE]: importArchive,
    [ServerFunctionOperation.GET_EXPORT_DOWNLOAD]: getExportDownload,
    [ServerFunctionOperation.GET_STATISTICS]: getStatistics,
    [ServerFunctionOperation.LIST_EXPENSES]: listExpenses,
    [ServerFunctionOperation.GET_EXPENSE]: getExpense,
    [ServerFunctionOperation.CREATE_EXPENSE]: createExpense,
    [ServerFunctionOperation.UPDATE_EXPENSE]: updateExpense,
    [ServerFunctionOperation.DELETE_EXPENSE]: deleteExpense,
    [ServerFunctionOperation.LIST_EXPENSE_CATEGORIES]: listExpenseCategories,
    [ServerFunctionOperation.CREATE_EXPENSE_CATEGORY]: createExpenseCategory,
    [ServerFunctionOperation.UPDATE_EXPENSE_CATEGORY]: updateExpenseCategory,
    [ServerFunctionOperation.DELETE_EXPENSE_CATEGORY]: deleteExpenseCategory,

    [ServerFunctionOperation.LIST_FUEL_RECORDS]: listFuelRecords,
    [ServerFunctionOperation.GET_FUEL_RECORD]: getFuelRecord,
    [ServerFunctionOperation.CREATE_FUEL_RECORD]: createFuelRecord,
    [ServerFunctionOperation.UPDATE_FUEL_RECORD]: updateFuelRecord,
    [ServerFunctionOperation.DELETE_FUEL_RECORD]: deleteFuelRecord,

    [ServerFunctionOperation.LIST_VEHICLES]: listVehicles,
    [ServerFunctionOperation.GET_VEHICLE]: getVehicle,
    [ServerFunctionOperation.CREATE_VEHICLE]: createVehicle,
    [ServerFunctionOperation.UPDATE_VEHICLE]: updateVehicle,
    [ServerFunctionOperation.DELETE_VEHICLE]: deleteVehicle,
    [ServerFunctionOperation.REGISTER]: register,
    [ServerFunctionOperation.GET_REGISTRATION_AVAILABILITY]: getRegistrationAvailability,
    [ServerFunctionOperation.LOGIN]: login,
    [ServerFunctionOperation.GET_CURRENT_USER]: getCurrentUser,
    [ServerFunctionOperation.LOGOUT]: logout,
    [ServerFunctionOperation.LIST_USERS]: listUsers,
    [ServerFunctionOperation.MANAGE_USER]: manageUser,
    [ServerFunctionOperation.DELETE_MY_ACCOUNT]: deleteMyAccount,
    [ServerFunctionOperation.UPDATE_MY_PROFILE]: updateMyProfile,
    [ServerFunctionOperation.CONFIRM_EMAIL]: confirmEmail,
    [ServerFunctionOperation.REQUEST_EMAIL_VERIFICATION]: requestEmailVerification,
    [ServerFunctionOperation.REQUEST_PASSWORD_RESET]: requestPasswordReset,
    [ServerFunctionOperation.RESET_PASSWORD]: resetPassword
} satisfies Record<ServerFunctionOperation, { url: string }>;

export function getServerFunctionOperation(request: Request): ServerFunctionOperation | undefined {
    const pathname = new URL(request.url).pathname;

    for (const operation of Object.values(ServerFunctionOperation)) {
        const serverFunction = functions[operation];

        if (new URL(serverFunction.url, request.url).pathname === pathname) return operation;
    }

    return undefined;
}

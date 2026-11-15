import { createFileRoute } from '@tanstack/react-router';
import { handleVehiclePicture } from '../../../vehicles/picture-request.server';
import { HttpMethod } from '../../../common/http';

export const Route = createFileRoute('/api/vehicle-pictures/$vehicleId')({
    server: {
        handlers: {
            [HttpMethod.GET]: ({ request, params }) => handleVehiclePicture(request, params.vehicleId),
            [HttpMethod.POST]: ({ request, params }) => handleVehiclePicture(request, params.vehicleId),
            [HttpMethod.DELETE]: ({ request, params }) => handleVehiclePicture(request, params.vehicleId)
        }
    }
});

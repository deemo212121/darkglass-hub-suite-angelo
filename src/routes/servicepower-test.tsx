import { createFileRoute } from '@tanstack/react-router';
import { ServicePowerTest } from '@/components/ServicePowerTest';

export const Route = createFileRoute('/servicepower-test')({
  component: ServicePowerTestPage,
});

function ServicePowerTestPage() {
  return (
    <div className="container mx-auto py-8">
      <ServicePowerTest />
    </div>
  );
}

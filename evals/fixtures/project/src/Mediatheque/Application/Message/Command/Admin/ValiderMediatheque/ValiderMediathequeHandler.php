<?php

declare(strict_types=1);

namespace Mediatheque\Application\Message\Command\Admin\ValiderMediatheque;

use Common\Domain\Adapter\MailerInterface;
use Mediatheque\Application\Message\Query\GetAdministrateursRegion\GetAdministrateursRegion;
use Mediatheque\Domain\Event\MediathequeValidee;
use Mediatheque\Domain\Model\Mediatheque;
use Mediatheque\Domain\Notification\ValidationInscriptionEmail;
use Mediatheque\Domain\Repository\MediathequeRepositoryInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Symfony\Component\Messenger\Envelope;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Messenger\Stamp\DispatchAfterCurrentBusStamp;
use Symfony\Component\Messenger\Stamp\HandledStamp;

#[AsMessageHandler(bus: 'command.bus')]
final readonly class ValiderMediathequeHandler
{
    public function __construct(
        private MediathequeRepositoryInterface $mediathequeRepository,
        private MailerInterface $mailer,
        #[Autowire(service: 'event.bus')]
        private MessageBusInterface $eventBus,
        #[Autowire(service: 'query.bus')]
        private MessageBusInterface $queryBus,
    ) {
    }

    public function __invoke(ValiderMediatheque $command): Mediatheque
    {
        $mediatheque = $command->mediatheque;
        $mediatheque->approve($command->administrateur);

        $this->mediathequeRepository->save($mediatheque);

        $mediathequeId = $mediatheque->getId();
        \assert(null !== $mediathequeId);

        $event = new MediathequeValidee($mediathequeId);
        $envelope = (new Envelope($event))->with(new DispatchAfterCurrentBusStamp());
        $this->eventBus->dispatch($envelope);

        $this->notifierAdministrateurs($mediatheque);

        return $mediatheque;
    }

    private function notifierAdministrateurs(Mediatheque $mediatheque): void
    {
        $administrateurs = $this->queryBus
            ->dispatch(new GetAdministrateursRegion($mediatheque->codePostal))
            ->last(HandledStamp::class)
            ?->getResult() ?? [];

        foreach ($administrateurs as $administrateur) {
            $this->mailer->send(new ValidationInscriptionEmail($mediatheque, $administrateur));
        }
    }
}

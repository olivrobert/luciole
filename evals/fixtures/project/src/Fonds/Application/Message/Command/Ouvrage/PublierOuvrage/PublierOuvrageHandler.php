<?php

declare(strict_types=1);

namespace Fonds\Application\Message\Command\Ouvrage\PublierOuvrage;

use Fonds\Domain\Event\ExemplaireRemisEnRayon;
use Fonds\Domain\Event\OuvragePublie;
use Fonds\Domain\Repository\OuvrageRepositoryInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Symfony\Component\Messenger\Envelope;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Messenger\Stamp\DispatchAfterCurrentBusStamp;

#[AsMessageHandler(bus: 'command.bus')]
final readonly class PublierOuvrageHandler
{
    public function __construct(
        private OuvrageRepositoryInterface $ouvrageRepository,
        #[Autowire(service: 'event.bus')]
        private MessageBusInterface $eventBus,
    ) {
    }

    public function __invoke(PublierOuvrage $command): void
    {
        $ouvrage = $command->ouvrage;
        $ouvrage->publier();

        $this->ouvrageRepository->save($ouvrage);

        $ouvrageId = $ouvrage->getId();
        \assert(null !== $ouvrageId);

        $this->eventBus->dispatch(
            (new Envelope(new OuvragePublie($ouvrageId)))->with(new DispatchAfterCurrentBusStamp()),
        );

        foreach ($ouvrage->exemplaires as $exemplaire) {
            if ($exemplaire->isEnReserve()) {
                $this->eventBus->dispatch(new Envelope(new ExemplaireRemisEnRayon($exemplaire->cote)));
            }
        }
    }
}

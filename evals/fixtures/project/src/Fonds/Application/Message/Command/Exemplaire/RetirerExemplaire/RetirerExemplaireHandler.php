<?php

declare(strict_types=1);

namespace Fonds\Application\Message\Command\Exemplaire\RetirerExemplaire;

use Fonds\Domain\Event\ExemplaireRetire;
use Fonds\Domain\Model\Exemplaire;
use Fonds\Domain\Repository\ExemplaireRepositoryInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Symfony\Component\Messenger\MessageBusInterface;

#[AsMessageHandler(bus: 'command.bus')]
readonly class RetirerExemplaireHandler
{
    public function __construct(
        private ExemplaireRepositoryInterface $exemplaireRepository,
        #[Autowire(service: 'event.bus')]
        private MessageBusInterface $eventBus,
    ) {
    }

    public function __invoke(RetirerExemplaire $command): Exemplaire
    {
        $exemplaire = $command->exemplaire;
        $exemplaire->retirer();

        $this->exemplaireRepository->save($exemplaire);

        $exemplaireId = $exemplaire->getId();
        \assert(null !== $exemplaireId);

        $this->eventBus->dispatch(new ExemplaireRetire($exemplaireId));

        return $exemplaire;
    }
}

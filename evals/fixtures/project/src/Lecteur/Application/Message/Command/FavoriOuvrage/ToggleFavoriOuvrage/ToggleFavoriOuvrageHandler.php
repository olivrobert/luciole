<?php

declare(strict_types=1);

namespace Lecteur\Application\Message\Command\FavoriOuvrage\ToggleFavoriOuvrage;

use Lecteur\Application\Message\Command\FavoriOuvrage\AddFavoriOuvrage\AddFavoriOuvrage;
use Lecteur\Application\Message\Command\FavoriOuvrage\RemoveFavoriOuvrage\RemoveFavoriOuvrage;
use Lecteur\Domain\Exception\ExemplaireNonDisponibleException;
use Lecteur\Domain\Repository\FavoriOuvrage\FavoriOuvrageRepositoryInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Symfony\Component\Messenger\MessageBusInterface;

#[AsMessageHandler(bus: 'command.bus')]
final readonly class ToggleFavoriOuvrageHandler
{
    public function __construct(
        private FavoriOuvrageRepositoryInterface $favoriOuvrageRepository,
        #[Autowire(service: 'command.bus')]
        private MessageBusInterface $commandBus,
    ) {
    }

    public function __invoke(ToggleFavoriOuvrage $command): void
    {
        if ($this->favoriOuvrageRepository->existsForLecteurAndExemplaire($command->lecteur, $command->exemplaire)) {
            $this->commandBus->dispatch(new RemoveFavoriOuvrage($command->lecteur, $command->exemplaire));

            return;
        }

        if (!$command->exemplaire->statut->isDisponible()) {
            throw new ExemplaireNonDisponibleException();
        }

        $this->commandBus->dispatch(new AddFavoriOuvrage($command->lecteur, $command->exemplaire));
    }
}

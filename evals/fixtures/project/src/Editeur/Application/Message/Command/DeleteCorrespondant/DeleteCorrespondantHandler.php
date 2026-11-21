<?php

declare(strict_types=1);

namespace Editeur\Application\Message\Command\DeleteCorrespondant;

use Editeur\Domain\Repository\CorrespondantRepositoryInterface;
use Identite\Domain\Repository\UtilisateurRepositoryInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(bus: 'command.bus')]
final readonly class DeleteCorrespondantHandler
{
    public function __construct(
        private CorrespondantRepositoryInterface $correspondantRepository,
        private UtilisateurRepositoryInterface $utilisateurRepository,
    ) {
    }

    public function __invoke(DeleteCorrespondant $command): void
    {
        $correspondant = $command->correspondant;
        $utilisateur = $correspondant->utilisateur;
        $editeur = $utilisateur->editeur;
        \assert(null !== $editeur);

        if ($correspondant->visible && !$this->correspondantRepository->hasOtherVisibleCorrespondant($editeur, $correspondant->id)) {
            throw new \RuntimeException('Impossible de supprimer le dernier correspondant visible.');
        }

        $this->correspondantRepository->remove($correspondant);

        if (!$utilisateur->isPrimary) {
            $this->utilisateurRepository->remove($utilisateur);
        }
    }
}

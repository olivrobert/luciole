<?php

declare(strict_types=1);

namespace Fonds\Application\Message\Query\GetOuvrage;

use Fonds\Domain\Exception\OuvrageIntrouvableException;
use Fonds\Domain\Repository\OuvrageRepositoryInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(bus: 'command.bus')]
final readonly class GetOuvrageHandler
{
    public function __construct(
        private OuvrageRepositoryInterface $ouvrageRepository,
    ) {
    }

    public function __invoke(GetOuvrage $query): OuvrageView
    {
        $ouvrage = $this->ouvrageRepository->findById($query->id);

        if (null === $ouvrage) {
            throw new OuvrageIntrouvableException($query->id);
        }

        return OuvrageView::fromOuvrage($ouvrage);
    }
}

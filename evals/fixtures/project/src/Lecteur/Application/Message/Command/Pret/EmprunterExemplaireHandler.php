<?php

declare(strict_types=1);

namespace Lecteur\Application\Message\Command\Pret;

use Lecteur\Application\Message\Command\EmprunterExemplaire\EmprunterExemplaire;
use Lecteur\Domain\Exception\QuotaPretsAtteintException;
use Lecteur\Domain\Model\Pret;
use Lecteur\Domain\Repository\PretRepositoryInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(bus: 'command.bus')]
final readonly class EmprunterExemplaireHandler
{
    private const int QUOTA = 5;

    public function __construct(
        private PretRepositoryInterface $pretRepository,
    ) {
    }

    public function __invoke(EmprunterExemplaire $command): Pret
    {
        if ($this->pretRepository->countEnCoursForLecteur($command->lecteur) >= self::QUOTA) {
            throw new QuotaPretsAtteintException(self::QUOTA);
        }

        $command->exemplaire->emprunter();
        $pret = new Pret($command->lecteur, $command->exemplaire);

        $this->pretRepository->save($pret);

        return $pret;
    }
}

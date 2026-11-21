<?php

declare(strict_types=1);

namespace Lecteur\Infrastructure\Symfony\Controller\App\Pret;

use Lecteur\Application\Message\Query\GetHistoriquePrets\GetHistoriquePrets;
use Lecteur\Domain\Model\Lecteur;
use Lecteur\Infrastructure\Symfony\Voter\LecteurVoter;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Messenger\Stamp\HandledStamp;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[Route('/{id}/prets', name: 'lecteur_prets', methods: [Request::METHOD_GET], requirements: ['id' => '\d+'])]
#[IsGranted(LecteurVoter::VIEW, subject: 'lecteur')]
final class HistoriqueController extends AbstractController
{
    public function __invoke(Lecteur $lecteur, MessageBusInterface $queryBus): Response
    {
        $prets = $queryBus
            ->dispatch(new GetHistoriquePrets($lecteur))
            ->last(HandledStamp::class)
            ?->getResult() ?? [];

        return $this->render('admin/lecteur/pret/historique.html.twig', [
            'lecteur' => $lecteur,
            'prets' => $prets,
        ]);
    }
}
